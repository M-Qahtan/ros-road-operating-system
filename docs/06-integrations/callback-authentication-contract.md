# Callback Authentication and Replay Contract

Status: engineering contract for sandbox / controlled integration preparation. This document does not authorize a real agency endpoint or production secret distribution.

## Trust boundary

A callback is accepted only after all of the following succeed:

1. the exact integration principal `{clientId, tenantId, purpose}` is known;
2. the supplied `keyId` resolves to key material for that exact principal;
3. the callback timestamp is fresh and falls inside the selected key's validity window;
4. the HMAC-SHA-256 signature matches the canonical callback representation;
5. the scoped nonce claim is durably inserted into PostgreSQL exactly once.

Failure of key resolution or replay storage fails closed.

## Canonical signed representation

The v1 canonical form is domain separated as `ros-callback-hmac-v1` and binds:

- client ID;
- tenant ID;
- purpose;
- key ID;
- timestamp;
- nonce;
- SHA-256 of the callback body.

Variable-length fields use explicit UTF-8 byte lengths. This prevents delimiter reinterpretation between nonce/body or other fields.

The raw body is limited to 1 MiB before hashing in this verifier.

## Key rotation

`keyId` is part of the signature and the key provider resolves it under the exact principal binding. Multiple keys may overlap during a controlled rotation window, but each key has an explicit valid-from / valid-until interval.

Replay identity intentionally excludes `keyId`: the same nonce for the same principal remains consumed across old/new keys. Rotation therefore cannot reopen a previously used nonce.

Actual production key storage/distribution is a separate approval gate; this contract does not embed production secrets.

## Replay ledger

Migration `0013_integration_callback_nonce.sql` stores:

- client ID;
- tenant ID;
- purpose;
- nonce;
- key ID used for the successful claim;
- claim time;
- expiry.

Primary uniqueness is `{clientId, tenantId, purpose, nonce}`. The same opaque nonce may exist for a different exact principal so one partner cannot consume another partner's nonce namespace.

Rows are immutable on the request path. Expired-row pruning is an explicit maintenance operation and never an automatic acceptance/retry mechanism.

## Current evidence boundary

The current integration proof verifies PostgreSQL-backed exactly-once nonce claim, tamper rejection before nonce consumption, delimiter reinterpretation rejection, replay rejection across key rotation, and cross-principal nonce isolation.

mTLS/JWS profiles, production secret/KMS integration, callback endpoint lifecycle, external certificates, and real partner connectivity remain separate gates.