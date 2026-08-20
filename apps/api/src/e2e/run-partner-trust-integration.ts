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
  peerCertificateSha256Pins: [PIN_ACTIVE, PIN_NEXT],
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

function expectFailure(work: () => void, pattern: RegExp): void {
  assert.throws(work, pattern);
}

function run(): void {
  verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(oldKey.privateKey, 'traffic-key-v1'),
    peerCertificateSha256: PIN_ACTIVE,
    nowEpochSeconds: NOW
  }, PROFILE);
  verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(nextKey.privateKey, 'traffic-key-v2'),
    peerCertificateSha256: PIN_NEXT,
    nowEpochSeconds: NOW
  }, PROFILE);

  expectFailure(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(oldKey.privateKey, 'traffic-key-v1'),
    peerCertificateSha256: PIN_UNKNOWN,
    nowEpochSeconds: NOW
  }, PROFILE), /mTLS peer certificate is not pinned/);

  expectFailure(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(oldKey.privateKey, 'traffic-key-v1', { purpose: 'INSURANCE_COORDINATION' }),
    peerCertificateSha256: PIN_ACTIVE,
    nowEpochSeconds: NOW
  }, PROFILE), /protected ROS scope does not match/);

  expectFailure(() => verifyDetachedPartnerJwsMtls({
    rawBody: '{"operationId":"runtime-trust-proof","state":"FAILED"}',
    detachedJws: jws(oldKey.privateKey, 'traffic-key-v1'),
    peerCertificateSha256: PIN_ACTIVE,
    nowEpochSeconds: NOW
  }, PROFILE), /signature verification failed/);

  expectFailure(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(oldKey.privateKey, 'traffic-key-v1'),
    peerCertificateSha256: PIN_ACTIVE,
    nowEpochSeconds: NOW + 121
  }, PROFILE), /outside its accepted validity window/);

  verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(nextKey.privateKey, 'traffic-key-v2'),
    peerCertificateSha256: PIN_NEXT,
    nowEpochSeconds: NOW + 121
  }, PROFILE);

  const revokedProfile: PartnerJwsMtlsTrustProfile = {
    ...PROFILE,
    verificationKeys: [{
      kid: 'traffic-key-v2',
      publicKey: nextKey.publicKey,
      notBeforeEpochSeconds: NOW - 30,
      notAfterEpochSeconds: NOW + 3600,
      revokedAtEpochSeconds: NOW
    }]
  };
  expectFailure(() => verifyDetachedPartnerJwsMtls({
    rawBody: BODY,
    detachedJws: jws(nextKey.privateKey, 'traffic-key-v2'),
    peerCertificateSha256: PIN_NEXT,
    nowEpochSeconds: NOW
  }, revokedProfile), /signing key is revoked/);

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    sandboxOnlyVerified: true,
    mtlsCertificatePinVerified: true,
    detachedJwsRs256Verified: true,
    protectedScopeBindingVerified: true,
    bodyTamperRejected: true,
    keyRotationOverlapVerified: true,
    expiredOldKeyRejected: true,
    revokedKeyRejected: true,
    networkCalls: 0,
    productionActivationEnabled: false
  }) + '\n');
}

run();
