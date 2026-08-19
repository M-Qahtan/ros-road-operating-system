import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import { CallbackReplayStore } from './callback-auth.js';

function requireNonce(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 256) {
    throw new TypeError('Callback nonce must contain between 1 and 256 characters');
  }
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

  async claim(nonce: string, expiresAtEpochSeconds: number): Promise<boolean> {
    const normalizedNonce = requireNonce(nonce);
    const expiry = requireExpiry(expiresAtEpochSeconds);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO integration_callback_nonces (nonce, expires_at)
         VALUES ($1, to_timestamp($2))
         ON CONFLICT (nonce) DO NOTHING
         RETURNING nonce`,
        [normalizedNonce, expiry]
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}
