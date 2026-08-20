import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EnvironmentObjectStorageCredentialProvider,
  ObjectStorageCredentialProviderPort,
  ObjectStorageRuntimeConfigurationError,
  RotatingMinioEvidenceStorageAdapter,
  createEvidenceObjectStorageForRuntime
} from './object-storage-runtime.js';

const NOW = new Date('2026-08-19T21:00:00.000Z');

function production(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    OBJECT_STORAGE_ENDPOINT: 'https://evidence.example.test',
    OBJECT_STORAGE_REGION: 'eu-central-1',
    OBJECT_STORAGE_BUCKET: 'ros-evidence',
    OBJECT_STORAGE_ACCESS_KEY: 'temporary-access-key',
    OBJECT_STORAGE_SECRET_KEY: 'temporary-secret-material',
    OBJECT_STORAGE_SESSION_TOKEN: 'temporary-session-token-material',
    OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT: '2026-08-19T22:00:00.000Z',
    ...overrides
  };
}

test('production environment credentials require temporary session material and explicit expiry', async () => {
  const provider = new EnvironmentObjectStorageCredentialProvider(production(), true, () => new Date(NOW));
  assert.deepEqual(await provider.resolve(), {
    accessKeyId: 'temporary-access-key',
    secretAccessKey: 'temporary-secret-material',
    sessionToken: 'temporary-session-token-material',
    expiresAt: new Date('2026-08-19T22:00:00.000Z')
  });

  await assert.rejects(
    new EnvironmentObjectStorageCredentialProvider(
      production({ OBJECT_STORAGE_SESSION_TOKEN: '' }),
      true,
      () => new Date(NOW)
    ).resolve(),
    /requires temporary session credentials/
  );
  await assert.rejects(
    new EnvironmentObjectStorageCredentialProvider(
      production({ OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT: '' }),
      true,
      () => new Date(NOW)
    ).resolve(),
    /requires temporary session credentials/
  );
});

test('production object storage rejects plaintext endpoints before any request occurs', () => {
  assert.throws(
    () => createEvidenceObjectStorageForRuntime(production({
      OBJECT_STORAGE_ENDPOINT: 'http://evidence.example.test'
    })),
    /must use HTTPS/
  );
});

test('non-production local object storage may use static credentials over HTTP', () => {
  assert.doesNotThrow(() => createEvidenceObjectStorageForRuntime({
    NODE_ENV: 'test',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'ros-evidence',
    OBJECT_STORAGE_ACCESS_KEY: 'ros-local',
    OBJECT_STORAGE_SECRET_KEY: 'local-secret-password'
  }));
});

test('rotating adapter resolves fresh credentials for every signed request', async () => {
  let calls = 0;
  const provider: ObjectStorageCredentialProviderPort = {
    async resolve() {
      calls += 1;
      return {
        accessKeyId: `access-${calls}`,
        secretAccessKey: 'temporary-secret-material',
        sessionToken: `temporary-session-token-${calls}`,
        expiresAt: new Date('2026-08-19T22:00:00.000Z')
      };
    }
  };
  const adapter = new RotatingMinioEvidenceStorageAdapter({
    endpoint: 'https://evidence.example.test',
    region: 'eu-central-1',
    bucket: 'ros-evidence',
    production: true,
    credentialProvider: provider,
    now: () => new Date(NOW)
  });

  const first = await adapter.createDownloadRequest(
    'road-events/event/evidence/id/file',
    new Date('2026-08-19T21:01:00.000Z')
  );
  const second = await adapter.createDownloadRequest(
    'road-events/event/evidence/id/file',
    new Date('2026-08-19T21:01:00.000Z')
  );

  assert.equal(calls, 2);
  assert.match(first.url, /access-1/);
  assert.match(second.url, /access-2/);
  assert.equal(new URL(first.url).searchParams.get('X-Amz-Security-Token'), 'temporary-session-token-1');
  assert.equal(new URL(second.url).searchParams.get('X-Amz-Security-Token'), 'temporary-session-token-2');
});

test('temporary credentials must outlive the signed operation safety margin', async () => {
  const provider: ObjectStorageCredentialProviderPort = {
    async resolve() {
      return {
        accessKeyId: 'temporary-access',
        secretAccessKey: 'temporary-secret-material',
        sessionToken: 'temporary-session-token',
        expiresAt: new Date('2026-08-19T21:01:20.000Z')
      };
    }
  };
  const adapter = new RotatingMinioEvidenceStorageAdapter({
    endpoint: 'https://evidence.example.test',
    region: 'eu-central-1',
    bucket: 'ros-evidence',
    production: true,
    credentialProvider: provider,
    now: () => new Date(NOW)
  });

  await assert.rejects(
    adapter.createDownloadRequest(
      'road-events/event/evidence/id/file',
      new Date('2026-08-19T21:01:00.000Z')
    ),
    /do not outlive the signed operation safety margin/
  );
});

test('expired environment credentials fail closed', async () => {
  const provider = new EnvironmentObjectStorageCredentialProvider(
    production({ OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT: '2026-08-19T21:00:20.000Z' }),
    true,
    () => new Date(NOW)
  );
  await assert.rejects(provider.resolve(), ObjectStorageRuntimeConfigurationError);
});
