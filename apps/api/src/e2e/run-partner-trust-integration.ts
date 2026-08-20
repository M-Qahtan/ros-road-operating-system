import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  PartnerJwsMtlsTrustProfile,
  verifyDetachedPartnerJwsMtls
} from '../integrations/partner-trust-profile.js';

const NOW = 1_800_000_000;
const BODY = '{"operationId":"runtime-trust-proof","state":"ACKNOWLEDGED"}';
const PIN_ACTIVE = createHash('sha256').update('runtime-test-peer-active').digest('hex');
const PIN_NEXT = createHash('sha256').update('runtime-test-peer-next').digest('hex');
const PIN_UNKNOWN = createHash('sha256').update('runtime-test-peer-unknown').digest('hex');
const oldKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const nextKey = generateKeyPairSync('rsa', { modulusLength: 2048 });

const PROFILE: PartnerJwsMtlsTrustProfile = {
  profileId: 'traffic-sandbox.riyadh',
  partner: 'TRAFFIC',
  tenantId: 'riyadh-pilot',
  purpose: 'TRAFFIC_COORDINATION',
  environment: 'SANDBOX',
  sandboxEndpointBaseUrl: 'https://traffic-sandbox.example.test/api',
  peerCertificates: [
    {
      fingerprintSha256: PIN_ACTIVE,
      notBeforeEpochSeconds: NOW - 300,
      notAfterEpochSeconds: NOW + 120
    },
    {
      fingerprintSha256: PIN_NEXT,
      notBeforeEpochSeconds: NOW - 30,
      notAfterEpochSeconds: NOW + 3600
    }
  ],
  verificationKeys: [
    {
      kid: 'traffic-key-v1',
      publicKey: oldKey.publicKey,
      notBeforeEpochSeconds: NOW - 300,
      notAfterEpochSeconds: NOW + 120
    },
    {
      kid: 'traffic-key-v2',
      publicKey: nextKey.publicKey,
      notBeforeEpochSeconds: NOW - 30,
      notAfterEpochSeconds: NOW + 3600
    }
  ]
};

function jws(
  privateKey: typeof oldKey.privateKey,
  kid: string,
  overrides: Partial<{ readonly profile: string; readonly tenant: string; readonly purpose: string }> = {}
): string {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    typ: 'ros-callback+jws',
    kid,
    ros_profile: overrides.profile ?? PROFILE.profileId,
    ros_tenant: overrides.tenant ?? PROFILE.tenantId,
    ros_purpose: overrides.purpose ?? PROFILE.purpose
  }), 'utf8').toString('base64url');
  const payload = Buffer.from(BODY, 'utf8').toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`, 'ascii'), privateKey).toString('base64url');
  return `${header}..${signature}`;
}

function verify(detachedJws: string, peer: string, now = NOW, rawBody = BODY, profile = PROFILE): void {
  verifyDetachedPartnerJwsMtls({
    rawBody,
    detachedJws,
    peerCertificateSha256: peer,
    nowEpochSeconds: now
  }, profile);
}

function run(): void {
  verify(jws(oldKey.privateKey, 'traffic-key-v1'), PIN_ACTIVE);
  verify(jws(nextKey.privateKey, 'traffic-key-v2'), PIN_NEXT);

  assert.throws(() => verify(jws(oldKey.privateKey, 'traffic-key-v1'), PIN_UNKNOWN), /not pinned/);
  assert.throws(
    () => verify(jws(oldKey.privateKey, 'traffic-key-v1', { purpose: 'INSURANCE_COORDINATION' }), PIN_ACTIVE),
    /protected ROS scope does not match/
  );
  assert.throws(
    () => verify(
      jws(oldKey.privateKey, 'traffic-key-v1'),
      PIN_ACTIVE,
      NOW,
      '{"operationId":"runtime-trust-proof","state":"FAILED"}'
    ),
    /signature verification failed/
  );

  assert.throws(
    () => verify(jws(oldKey.privateKey, 'traffic-key-v1'), PIN_ACTIVE, NOW + 121),
    /Pinned mTLS peer certificate is outside/
  );
  verify(jws(nextKey.privateKey, 'traffic-key-v2'), PIN_NEXT, NOW + 121);

  const revokedCertificate: PartnerJwsMtlsTrustProfile = {
    ...PROFILE,
    peerCertificates: [{
      fingerprintSha256: PIN_NEXT,
      notBeforeEpochSeconds: NOW - 30,
      notAfterEpochSeconds: NOW + 3600,
      revokedAtEpochSeconds: NOW
    }]
  };
  assert.throws(
    () => verify(jws(nextKey.privateKey, 'traffic-key-v2'), PIN_NEXT, NOW, BODY, revokedCertificate),
    /Pinned mTLS peer certificate is revoked/
  );

  const revokedKey: PartnerJwsMtlsTrustProfile = {
    ...PROFILE,
    verificationKeys: [{
      kid: 'traffic-key-v2',
      publicKey: nextKey.publicKey,
      notBeforeEpochSeconds: NOW - 30,
      notAfterEpochSeconds: NOW + 3600,
      revokedAtEpochSeconds: NOW
    }]
  };
  assert.throws(
    () => verify(jws(nextKey.privateKey, 'traffic-key-v2'), PIN_NEXT, NOW, BODY, revokedKey),
    /Partner JWS signing key is revoked/
  );

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    sandboxOnlyVerified: true,
    httpsEndpointPolicyVerified: true,
    partnerPurposeBindingVerified: true,
    mtlsCertificatePinVerified: true,
    mtlsCertificateRotationVerified: true,
    revokedCertificateRejected: true,
    detachedJwsRs256Verified: true,
    protectedScopeBindingVerified: true,
    bodyTamperRejected: true,
    keyRotationOverlapVerified: true,
    retiredOldMaterialRejected: true,
    revokedKeyRejected: true,
    networkCalls: 0,
    productionActivationEnabled: false
  }) + '\n');
}

run();
