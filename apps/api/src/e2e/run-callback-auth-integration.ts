import assert from 'node:assert/strict';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import {
  CallbackHmacKey,
  CallbackHmacKeyProvider,
  CallbackPrincipalBinding,
  VerifyCallbackInput,
  computeCallbackSignatureHex,
  verifyCallbackHmac
} from '../integrations/callback-auth.js';
import { PostgresCallbackReplayStore } from '../integrations/postgres-callback-replay-store.js';

const NOW = 1_800_000_000;
const TRAFFIC: CallbackPrincipalBinding = {
  clientId: 'traffic-sandbox', tenantId: 'riyadh-pilot', purpose: 'TRAFFIC_COORDINATION'
};
const INSURANCE: CallbackPrincipalBinding = {
  clientId: 'insurance-sandbox', tenantId: 'riyadh-pilot', purpose: 'INSURANCE_COORDINATION'
};
const OLD_SECRET = 'old-integration-test-0123456789abcdef0123456789abcdef';
const NEW_SECRET = 'new-integration-test-0123456789abcdef0123456789abcdef';
const INSURANCE_SECRET = 'insurance-test-key-0123456789abcdef0123456789abcdef';

class IntegrationKeyProvider implements CallbackHmacKeyProvider {
  private readonly keys = new Map<string, CallbackHmacKey>([
    [JSON.stringify([TRAFFIC.clientId, TRAFFIC.tenantId, TRAFFIC.purpose, 'traffic-old']), {
      secret: OLD_SECRET, validFromEpochSeconds: NOW - 600, validUntilEpochSeconds: NOW + 60
    }],
    [JSON.stringify([TRAFFIC.clientId, TRAFFIC.tenantId, TRAFFIC.purpose, 'traffic-new']), {
      secret: NEW_SECRET, validFromEpochSeconds: NOW - 60, validUntilEpochSeconds: NOW + 3600
    }],
    [JSON.stringify([INSURANCE.clientId, INSURANCE.tenantId, INSURANCE.purpose, 'insurance-current']), {
      secret: INSURANCE_SECRET, validFromEpochSeconds: NOW - 60, validUntilEpochSeconds: NOW + 3600
    }]
  ]);

  async resolve(binding: CallbackPrincipalBinding, keyId: string): Promise<CallbackHmacKey | undefined> {
    return this.keys.get(JSON.stringify([binding.clientId, binding.tenantId, binding.purpose, keyId]));
  }
}

function signed(
  binding: CallbackPrincipalBinding,
  keyId: string,
  secret: string,
  nonce: string,
  body: string
): VerifyCallbackInput {
  const unsigned = { binding, keyId, nonce, body, timestampEpochSeconds: NOW };
  return { ...unsigned, signatureHex: computeCallbackSignatureHex(secret, unsigned) };
}

async function rowCount(
  postgres: ReturnType<typeof createNodePostgresPool>,
  binding: CallbackPrincipalBinding,
  nonce: string
): Promise<number> {
  const client = await postgres.connect();
  try {
    const result = await client.query<{ readonly count: number | string }>(
      `SELECT count(*) AS count
         FROM integration_callback_nonces
        WHERE client_id = $1 AND tenant_id = $2 AND purpose = $3 AND nonce = $4`,
      [binding.clientId, binding.tenantId, binding.purpose, nonce]
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  const replay = new PostgresCallbackReplayStore(postgres);
  const keys = new IntegrationKeyProvider();

  try {
    await postgres.verifyConnection();

    const cleanup = await postgres.connect();
    try {
      await cleanup.query(
        `DELETE FROM integration_callback_nonces
          WHERE client_id IN ('traffic-sandbox', 'insurance-sandbox')
            AND tenant_id = 'riyadh-pilot'`
      );
    } finally {
      cleanup.release();
    }

    const onceNonce = 'once-nonce-abcdef1234567890';
    const once = signed(TRAFFIC, 'traffic-new', NEW_SECRET, onceNonce, '{"status":"accepted"}');
    await verifyCallbackHmac(once, keys, replay, { nowEpochSeconds: NOW });
    await assert.rejects(
      verifyCallbackHmac(once, keys, replay, { nowEpochSeconds: NOW }),
      /already been used for this principal/
    );
    assert.equal(await rowCount(postgres, TRAFFIC, onceNonce), 1);

    const tamperNonce = 'tamper-nonce-abcdef12345678';
    const tamper = signed(TRAFFIC, 'traffic-new', NEW_SECRET, tamperNonce, '{"status":"accepted"}');
    await assert.rejects(
      verifyCallbackHmac({ ...tamper, body: '{"status":"rejected"}' }, keys, replay, { nowEpochSeconds: NOW }),
      /signature verification failed/
    );
    assert.equal(await rowCount(postgres, TRAFFIC, tamperNonce), 0);

    const delimiter = signed(TRAFFIC, 'traffic-new', NEW_SECRET, 'nonce-abcdefghijkl.b', 'c');
    await assert.rejects(
      verifyCallbackHmac({ ...delimiter, nonce: 'nonce-abcdefghijkl', body: 'b.c' }, keys, replay, { nowEpochSeconds: NOW }),
      /signature verification failed/
    );

    const rotationNonce = 'rotation-nonce-abcdef123456';
    await verifyCallbackHmac(
      signed(TRAFFIC, 'traffic-old', OLD_SECRET, rotationNonce, '{"state":"old-key"}'),
      keys,
      replay,
      { nowEpochSeconds: NOW }
    );
    await assert.rejects(
      verifyCallbackHmac(
        signed(TRAFFIC, 'traffic-new', NEW_SECRET, rotationNonce, '{"state":"new-key"}'),
        keys,
        replay,
        { nowEpochSeconds: NOW }
      ),
      /already been used for this principal/
    );
    assert.equal(await rowCount(postgres, TRAFFIC, rotationNonce), 1);

    const sharedNonce = 'shared-nonce-abcdef12345678';
    await verifyCallbackHmac(
      signed(TRAFFIC, 'traffic-new', NEW_SECRET, sharedNonce, '{"partner":"traffic"}'),
      keys,
      replay,
      { nowEpochSeconds: NOW }
    );
    await verifyCallbackHmac(
      signed(INSURANCE, 'insurance-current', INSURANCE_SECRET, sharedNonce, '{"partner":"insurance"}'),
      keys,
      replay,
      { nowEpochSeconds: NOW }
    );
    assert.equal(await rowCount(postgres, TRAFFIC, sharedNonce), 1);
    assert.equal(await rowCount(postgres, INSURANCE, sharedNonce), 1);

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      signatureBoundToPrincipal: true,
      bodyHashBound: true,
      delimiterReinterpretationRejected: true,
      postgresReplayExactlyOnce: true,
      replayBlockedAcrossKeyRotation: true,
      crossPrincipalNonceIsolation: true,
      tamperDoesNotConsumeNonce: true
    }) + '\n');
  } finally {
    await postgres.close();
  }
}

await run();
