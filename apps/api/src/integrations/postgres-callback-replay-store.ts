import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import { CallbackPrincipalBinding, CallbackReplayStore } from './callback-auth.js';

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) throw new TypeError(`${field} is invalid`);
  return normalized;
}

function requireNonce(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new TypeError('Callback nonce must contain between 16 and 256 safe characters');
  }
  return normalized;
}

function requireKeyId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_KEY_ID.test(normalized)) throw new TypeError('Callback keyId is invalid');
  return normalized;
}

function requireExpiry(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Callback nonce expiry must be a positive epoch-second integer');
  }
  return value;
}

export class PostgresCallbackReplayStore implements CallbackReplayStore {
  constructor(private readonly pool: PostgresPool) {}

  async claim(
    binding: CallbackPrincipalBinding,
    contractId: string,
    keyId: string,
    nonce: string,
    expiresAtEpochSeconds: number
  ): Promise<boolean> {
    const clientId = requireIdentifier(binding.clientId, 'Callback clientId');
    const tenantId = requireIdentifier(binding.tenantId, 'Callback tenantId');
    const purpose = requireIdentifier(binding.purpose, 'Callback purpose');
    const normalizedContractId = requireIdentifier(contractId, 'Callback contractId');
    const normalizedKeyId = requireKeyId(keyId);
    const normalizedNonce = requireNonce(nonce);
    const expiry = requireExpiry(expiresAtEpochSeconds);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO integration_callback_nonces (
           client_id, tenant_id, purpose, nonce, contract_id, key_id, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))
         ON CONFLICT (client_id, tenant_id, purpose, nonce) DO NOTHING
         RETURNING nonce`,
        [clientId, tenantId, purpose, normalizedNonce, normalizedContractId, normalizedKeyId, expiry]
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}
