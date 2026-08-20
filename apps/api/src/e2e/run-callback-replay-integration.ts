import assert from 'node:assert/strict';
import {
  CallbackAuthenticationError,
  TrustedCallbackProfile,
  computeCallbackSignatureHex,
  verifyCallbackHmac
} from '../integrations/callback-auth.js';
import { PostgresCallbackReplayStore } from '../integrations/postgres-callback-replay-store.js';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';

const TEST_HMAC_KEY_MATERIAL = 'runtime-test-only-0123456789abcdef0123456789abcdef';
const TRAFFIC_PROFILE: TrustedCallbackProfile = {
  profileId: 'traffic-sandbox.riyadh',
  secret: TEST_HMAC_KEY_MATERIAL
};
const INSURANCE_PROFILE: TrustedCallbackProfile = {
  profileId: 'insurance-sandbox.riyadh',
  secret: TEST_HMAC_KEY_MATERIAL
};
const NONCE = 'runtime-nonce-000000000001';
const BODY = '{"operationId":"callback-runtime-proof","status":"accepted"}';

function signed(profile: TrustedCallbackProfile, timestampEpochSeconds: number) {
  return {
    body: BODY,
    nonce: NONCE,
    timestampEpochSeconds,
    signatureHex: computeCallbackSignatureHex(profile, BODY, timestampEpochSeconds, NONCE)
  };
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  const now = Math.floor(Date.now() / 1000);
  try {
    await postgres.verifyConnection();
    const cleanup = await postgres.connect();
    try {
      await cleanup.query(
        `DELETE FROM integration_callback_nonces
          WHERE profile_id IN ($1, $2) AND nonce = $3`,
        [TRAFFIC_PROFILE.profileId, INSURANCE_PROFILE.profileId, NONCE]
      );
    } finally {
      cleanup.release();
    }

    const replayStore = new PostgresCallbackReplayStore(postgres);
    const traffic = signed(TRAFFIC_PROFILE, now);
    await verifyCallbackHmac(traffic, TRAFFIC_PROFILE, replayStore, { nowEpochSeconds: now });

    await assert.rejects(
      verifyCallbackHmac(traffic, TRAFFIC_PROFILE, replayStore, { nowEpochSeconds: now }),
      (error: unknown) =>
        error instanceof CallbackAuthenticationError &&
        /already been used for this profile/.test(error.message)
    );

    await assert.rejects(
      verifyCallbackHmac(traffic, INSURANCE_PROFILE, replayStore, { nowEpochSeconds: now }),
      (error: unknown) =>
        error instanceof CallbackAuthenticationError &&
        /signature verification failed/.test(error.message)
    );

    await verifyCallbackHmac(
      signed(INSURANCE_PROFILE, now),
      INSURANCE_PROFILE,
      replayStore,
      { nowEpochSeconds: now }
    );

    const verification = await postgres.connect();
    let immutable = false;
    try {
      const rows = await verification.query<{ profile_id: string; nonce: string }>(
        `SELECT profile_id, nonce
           FROM integration_callback_nonces
          WHERE profile_id IN ($1, $2) AND nonce = $3
          ORDER BY profile_id`,
        [TRAFFIC_PROFILE.profileId, INSURANCE_PROFILE.profileId, NONCE]
      );
      assert.equal(rows.rowCount, 2);
      assert.deepEqual(
        rows.rows.map((row) => row.profile_id),
        [INSURANCE_PROFILE.profileId, TRAFFIC_PROFILE.profileId]
      );
      assert.ok(rows.rows.every((row) => row.nonce === NONCE));

      try {
        await verification.query(
          `UPDATE integration_callback_nonces SET expires_at = expires_at + interval '1 second'
            WHERE profile_id = $1 AND nonce = $2`,
          [TRAFFIC_PROFILE.profileId, NONCE]
        );
      } catch (error) {
        immutable = error instanceof Error && /immutable/.test(error.message);
      }
      assert.equal(immutable, true);
    } finally {
      verification.release();
    }

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      callbackSignatureVerified: true,
      requestCannotOverrideProfileVerified: true,
      sameProfileReplayRejected: true,
      crossProfileSignatureBindingVerified: true,
      profileScopedNonceReuseVerified: true,
      durableNonceRows: 2,
      nonceImmutabilityVerified: true
    }) + '\n');
  } finally {
    await postgres.close();
  }
}

await run();
