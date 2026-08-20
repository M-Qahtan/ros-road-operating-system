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
    peerCertificateSha256Pins: [PIN_ONE, PIN_TWO],
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
    readonly typ?: string;
    readonly profileId?: string;
    readonly tenantId?: string;
    readonly purpose?: string;
    readonly body?: string;
  } = {}
): string {
  const body = options.body ?? BODY;
  const protectedHeader = Buffer.from(JSON.stringify({
    alg: options.alg ?? 'RS256',
    typ: options.typ ?? 'ros-callback+jws',
    kid: options.kid ?? 'traffic-key-v1',
    ros_profile: options.profileId ?? 'traffic-sandbox.riyadh',
    ros_tenant: options.tenantId ?? 'riyadh-pilot',
    ros_purpose: options.purpose ?? 'TRAFFIC_COORDINATION'
  }), 'utf8').toString('base64url');
  const payload = Buffer.from(body, 'utf8').toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${protectedHeader}.${payload}`, 'ascii'),
    privateKey
  ).toString('base64url');
  return `${protectedHeader}..${signature}`;
}

test('accepts pinned mTLS peer plus valid detached JWS bound to exact ROS scope', () => {
  assert.doesNotThrow(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()));
});

test('rejects an unpinned mTLS peer before trusting JWS contents', () => {
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: UNTRUSTED_PIN,
    nowEpochSeconds: NOW
  }, profile()), /mTLS peer certificate is not pinned/);
});

test('rejects cross-profile tenant or purpose transplant even with a valid signature', () => {
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey, { tenantId: 'other-tenant' }),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), /protected ROS scope does not match/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey, { purpose: 'INSURANCE_COORDINATION' }),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), /protected ROS scope does not match/);
});

test('rejects raw-body tampering and algorithm substitution', () => {
  const signed = detachedJws(key1.privateKey);
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: '{"operationId":"trust-proof","status":"failed"}',
    detachedJws: signed,
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), /signature verification failed/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey, { alg: 'none' }),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), /alg must be exactly RS256/);
});

test('supports bounded active-key overlap for rotation and rejects the old key after expiry', () => {
  assert.doesNotThrow(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()));
  assert.doesNotThrow(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key2.privateKey, { kid: 'traffic-key-v2' }),
    peerCertificateSha256: PIN_TWO,
    nowEpochSeconds: NOW
  }, profile()));

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW + 121
  }, profile()), /outside its accepted validity window/);

  assert.doesNotThrow(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key2.privateKey, { kid: 'traffic-key-v2' }),
    peerCertificateSha256: PIN_TWO,
    nowEpochSeconds: NOW + 121
  }, profile()));
});

test('rejects revoked or unknown signing keys fail closed', () => {
  const revoked = profile({
    verificationKeys: [{
      kid: 'traffic-key-v1',
      publicKey: key1.publicKey,
      notBeforeEpochSeconds: NOW - 300,
      notAfterEpochSeconds: NOW + 3600,
      revokedAtEpochSeconds: NOW - 1
    }]
  });
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, revoked), /signing key is revoked/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey, { kid: 'unknown-key' }),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), /signing key is not trusted/);
});

test('rejects weak RSA keys and malformed trust-profile rotation material', () => {
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile({
    verificationKeys: [{
      kid: 'traffic-key-v1',
      publicKey: weak.publicKey,
      notBeforeEpochSeconds: NOW - 1,
      notAfterEpochSeconds: NOW + 100
    }]
  })), /at least 2048 bits/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile({ peerCertificateSha256Pins: [PIN_ONE, PIN_ONE] })), /pins must be unique/);
});

test('rejects production-like activation and oversized trust inputs', () => {
  const unsafe = { ...profile(), environment: 'PRODUCTION' } as unknown as PartnerJwsMtlsTrustProfile;
  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, unsafe), /Only SANDBOX partner trust profiles are enabled/);

  assert.throws(() => verifyDetachedPartnerJwsMtls({
    rawBody: 'x'.repeat(1024 * 1024 + 1),
    detachedJws: detachedJws(key1.privateKey),
    peerCertificateSha256: PIN_ONE,
    nowEpochSeconds: NOW
  }, profile()), PartnerTrustVerificationError);
});
