import { PostgresPool } from '../persistence/postgres/postgres-types.js';
import { CallbackReplayStore } from './callback-auth.js';

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const NONCE_PATTERN = /^[A-Za-z0-9._~:-]+$/;

function requireProfileId(value: string): string {
  if (
    value.length < 1 || value.length > 128 || value !== value.trim() || !PROFILE_ID_PATTERN.test(value)
  ) {
    throw new TypeError('Callback profileId must be a canonical token between 1 and 128 characters');
  }
  return value;
}

function requireNonce(value: string): string {
  if (
    value.length < 16 || value.length > 256 || value !== value.trim() || !NONCE_PATTERN.test(value)
  ) {
    throw new TypeError('Callback nonce must be a canonical token between 16 and 256 characters');
  }
  return value;
}

function requireExpiry(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Callback nonce expiry must be a positive epoch-second integer');
  }
  return value;
}

export class PostgresCallbackReplayStore implements CallbackReplayStore {
  constructor(private readonly pool: PostgresPool) {}

  async claim(profileId: string, nonce: string, expiresAtEpochSeconds: number): Promise<boolean> {
    const normalizedProfile = requireProfileId(profileId);
    const normalizedNonce = requireNonce(nonce);
    const expiry = requireExpiry(expiresAtEpochSeconds);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO integration_callback_nonces (profile_id, nonce, expires_at)
         VALUES ($1, $2, to_timestamp($3))
         ON CONFLICT (profile_id, nonce) DO NOTHING
         RETURNING nonce`,
        [normalizedProfile, normalizedNonce, expiry]
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}
