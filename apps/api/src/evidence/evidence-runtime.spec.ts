import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRoadEventRepository } from '../application/local-adapters.js';
import { PostgresClient, PostgresPool } from '../persistence/postgres/postgres-types.js';
import { createEvidenceServiceForRuntime, EvidenceRuntimeCompositionError } from './evidence-runtime.js';
import { MalwareScanner } from './evidence-types.js';
import { ObjectStorageCredentialProviderPort } from './object-storage-runtime.js';

class UnusedPool implements PostgresPool {
  async connect(): Promise<PostgresClient> {
    throw new Error('Evidence runtime composition must not connect during construction');
  }
}

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test',
  OBJECT_STORAGE_REGION: 'eu-central-1',
  OBJECT_STORAGE_BUCKET: 'ros-evidence'
};

const credentials: ObjectStorageCredentialProviderPort = {
  resolve: async () => ({
    accessKeyId: 'temporary-access-key',
    secretAccessKey: 'temporary-secret-key-material',
    sessionToken: 'temporary-session-token',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  })
};

const scanner: MalwareScanner = {
  scan: async () => ({ outcome: 'CLEAN' })
};

test('production EvidenceService composition rejects implicit SafeLocalMalwareScanner', () => {
  assert.throws(
    () => createEvidenceServiceForRuntime(productionEnvironment, {
      postgres: new UnusedPool(),
      roadEvents: new MemoryRoadEventRepository(),
      credentialProvider: credentials
    }),
    EvidenceRuntimeCompositionError
  );
});

test('production EvidenceService can be composed only when a real scanner seam is injected', () => {
  const service = createEvidenceServiceForRuntime(productionEnvironment, {
    postgres: new UnusedPool(),
    roadEvents: new MemoryRoadEventRepository(),
    malwareScanner: scanner,
    credentialProvider: credentials
  });
  assert.ok(service);
});

test('non-production composition may use the deterministic local scanner without opening dependencies', () => {
  const service = createEvidenceServiceForRuntime({
    NODE_ENV: 'test',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'ros-evidence',
    OBJECT_STORAGE_ACCESS_KEY: 'local-access',
    OBJECT_STORAGE_SECRET_KEY: 'local-secret-material'
  }, {
    postgres: new UnusedPool(),
    roadEvents: new MemoryRoadEventRepository()
  });
  assert.ok(service);
});
