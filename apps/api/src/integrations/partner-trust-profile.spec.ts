import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  PartnerJwsMtlsTrustProfile,
  PartnerTrustVerificationError,
  verifyDetachedPartnerJwsMtls
} from './partner-trust-profile.js';

const NOW = 1_800_000_000;
const BODY = '{"operationId":"trust-proof","status":"acknowledged"}';
const PIN_ONE = createHash('sha256').update('test-peer-certificate-one').digest('hex');
const PIN_TWO = createHash('sha256').update('test-peer-certificate-two').digest('hex');
const UNTRUSTED_PIN = createHash('sha256').update('untrusted-peer-certificate').digest('hex');
const key1 = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key2 = generateKeyPairSync('rsa', { modulusLength: 2048 });

function profile(overrides: Partial<PartnerJwsMtlsTrustProfile> = {}): PartnerJwsMtlsTrustProfile {
  return {
    profileId: 'traffic-sandbox.riyadh',
    partner: 'TRAFFIC',
    tenantId: 'riyadh-pilot',
    purpose: 'TRAFFIC_COORDINATION',
    environment: 'SANDBOX',
    sandboxEndpointBaseUrl: 'https://traffic-sandbox.example.test/api',
    peerCertificates: [
      {
        fingerprintSha256: PIN_ONE,
        notBeforeEpochSeconds: NOW - 300,
        notAfterEpochSeconds: NOW + 120
      },
      {
        fingerprintSha256: PIN_TWO,
        notBeforeEpochSeconds: NOW - 30,
        notAfterEpochSeconds: NOW + 3600
      }
    ],
    verificationKeys: [
      {
        kid: 'traffic-key-v1',
        publicKey: key1.publicKey,
        notBeforeEpochSeconds: NOW - 300,
        notAfterEpochSeconds: NOW + 120
      },
      {
        kid: 'traffic-key-v2',
        publicKey: key2.publicKey,
        notBeforeEpochSeconds: NOW - 30,
        notAfterEpochSeconds: NOW + 3600
      }
    ],
    ...overrides
  };
}

function detachedJws(
  privateKey: typeof key1.privateKey,
  options: {
    readonly kid?: string;
    readonly alg?: string;
    readonly profileId?: string;
    readonly tenantId?: string;
    readonly purpose?: string;
    readonly body?: string;
  } = {}
): string {
  const body = options.body ?? BODY;
  const protectedHeader = Buffer.from(JSON.stringify({
    alg: options.alg ?? 'RS256',
    typ: 'ros-callback+jws',
    kid: options.kid ?? 'traffic-key-v1',
    ros_profile: options.profileId ?? 'traffic-sandbox.riyadh',
    ros_tenant: options.tenantId ?? 'riyadh-pilot',
    ros_purpose: options.purpose ?? 'TRAFFIC_COORDINATION'
  }), 'utf8').toString('base64url');
  const payload = Buffer.from(body, 'utf8').toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${protectedHeader}.${payload}`, 'ascii'), privateKey).toString('base64url');
  return `${protectedHeader}..${signature}`;
}

function verifyWith(
  trustProfile: PartnerJwsMtlsTrustProfile,
  detached = detachedJws(key1.privateKey),
  peer = PIN_ONE,
  now = NOW,
  rawBody = BODY
): void {
  verifyDetachedPartnerJwsMtls({
    rawBody,
    detachedJws: detached,
    peerCertificateSha256: peer,
    nowEpochSeconds: now
  }, trustProfile);
}

test('accepts active pinned mTLS certificate and valid detached JWS bound to exact scope', () => {
  assert.doesNotThrow(() => verifyWith(profile()));
});

test('enforces trusted partner-purpose binding and sandbox-only HTTPS endpoint metadata', () => {
  assert.throws(() => verifyWith(profile({ purpose: 'INSURANCE_COORDINATION' })), /requires purpose TRAFFIC_COORDINATION/);
  assert.throws(() => verifyWith(profile({ sandboxEndpointBaseUrl: 'http://traffic.example.test' })), /must use HTTPS/);
  assert.throws(() => verifyWith(profile({ sandboxEndpointBaseUrl: 'https://user:pass@traffic.example.test/api' })), /must not contain credentials/);
  const unsafe = { ...profile(), environment: 'PRODUCTION' } as unknown as PartnerJwsMtlsTrustProfile;
  assert.throws(() => verifyWith(unsafe), /Only SANDBOX partner trust profiles are enabled/);
});

test('rejects unpinned, expired and revoked mTLS certificate pins fail closed', () => {
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey), UNTRUSTED_PIN), /not pinned/);
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey), PIN_ONE, NOW + 121), /Pinned mTLS peer certificate is outside/);

  const revoked = profile({
    peerCertificates: [{
      fingerprintSha256: PIN_ONE,
      notBeforeEpochSeconds: NOW - 100,
      notAfterEpochSeconds: NOW + 100,
      revokedAtEpochSeconds: NOW
    }]
  });
  assert.throws(() => verifyWith(revoked), /Pinned mTLS peer certificate is revoked/);
});

test('rejects cross-tenant or cross-purpose protected-header transplant', () => {
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey, { tenantId: 'other-tenant' })), /protected ROS scope does not match/);
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey, { purpose: 'INSURANCE_COORDINATION' })), /protected ROS scope does not match/);
});

test('rejects raw-body tampering and algorithm substitution', () => {
  assert.throws(
    () => verifyWith(profile(), detachedJws(key1.privateKey), PIN_ONE, NOW, '{"operationId":"trust-proof","status":"failed"}'),
    /signature verification failed/
  );
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey, { alg: 'none' })), /alg must be exactly RS256/);
});

test('supports bounded key and certificate rotation overlap then rejects retired material', () => {
  assert.doesNotThrow(() => verifyWith(profile(), detachedJws(key1.privateKey), PIN_ONE, NOW));
  assert.doesNotThrow(() => verifyWith(profile(), detachedJws(key2.privateKey, { kid: 'traffic-key-v2' }), PIN_TWO, NOW));

  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey), PIN_ONE, NOW + 121), /Pinned mTLS peer certificate is outside/);
  assert.doesNotThrow(() => verifyWith(profile(), detachedJws(key2.privateKey, { kid: 'traffic-key-v2' }), PIN_TWO, NOW + 121));
});

test('rejects revoked, expired, unknown or weak JWS keys', () => {
  const revoked = profile({
    verificationKeys: [{
      kid: 'traffic-key-v1',
      publicKey: key1.publicKey,
      notBeforeEpochSeconds: NOW - 300,
      notAfterEpochSeconds: NOW + 3600,
      revokedAtEpochSeconds: NOW
    }]
  });
  assert.throws(() => verifyWith(revoked), /Partner JWS signing key is revoked/);
  assert.throws(() => verifyWith(profile(), detachedJws(key1.privateKey, { kid: 'unknown-key' })), /signing key is not trusted/);

  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  assert.throws(() => verifyWith(profile({
    verificationKeys: [{
      kid: 'traffic-key-v1',
      publicKey: weak.publicKey,
      notBeforeEpochSeconds: NOW - 1,
      notAfterEpochSeconds: NOW + 100
    }]
  })), /at least 2048 bits/);
});

test('rejects duplicate pins and oversized trust inputs', () => {
  assert.throws(() => verifyWith(profile({
    peerCertificates: [
      { fingerprintSha256: PIN_ONE, notBeforeEpochSeconds: NOW - 1, notAfterEpochSeconds: NOW + 100 },
      { fingerprintSha256: PIN_ONE, notBeforeEpochSeconds: NOW - 1, notAfterEpochSeconds: NOW + 100 }
    ]
  })), /pins must be unique/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: 'x'.repeat(1024 * 1024 + 1),
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), PartnerTrustVerificationError);
});
