import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EcsTaskRoleObjectStorageCredentialProvider,
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

function ecsCredentialResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    AccessKeyId: 'ecs-temporary-access-key',
    SecretAccessKey: 'ecs-temporary-secret-material',
    Token: 'test-only-ecs-session-token-material',
    Expiration: '2026-08-19T22:00:00.000Z',
    RoleArn: 'arn:aws:iam::123456789012:role/ros-staging-task',
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

test('ECS task-role provider uses only the fixed link-local relative credential endpoint', async () => {
  let observedUrl = '';
  let observedRedirect: RequestRedirect | undefined;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    observedUrl = String(input);
    observedRedirect = init?.redirect;
    return new Response(JSON.stringify(ecsCredentialResponse()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  const provider = new EcsTaskRoleObjectStorageCredentialProvider(
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc123' },
    fetchImpl,
    () => new Date(NOW)
  );

  assert.deepEqual(await provider.resolve(), {
    accessKeyId: 'ecs-temporary-access-key',
    secretAccessKey: 'ecs-temporary-secret-material',
    sessionToken: 'test-only-ecs-session-token-material',
    expiresAt: new Date('2026-08-19T22:00:00.000Z')
  });
  assert.equal(observedUrl, 'http://169.254.170.2/v2/credentials/abc123');
  assert.equal(observedRedirect, 'error');
});

test('ECS task-role provider rejects URI escape attempts before network access', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  for (const relativeUri of [
    '//evil.example/v2/credentials/x',
    '/v2/credentials/../metadata',
    '/v2/credentials/x?next=https://evil.example',
    '/v2/credentials/x#fragment',
    '/v1/credentials/x'
  ]) {
    const provider = new EcsTaskRoleObjectStorageCredentialProvider(
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: relativeUri },
      fetchImpl,
      () => new Date(NOW)
    );
    await assert.rejects(provider.resolve(), ObjectStorageRuntimeConfigurationError);
  }
  assert.equal(calls, 0);
});

test('ECS task-role provider fails closed for expired, malformed or oversized credential responses', async () => {
  const expired = new EcsTaskRoleObjectStorageCredentialProvider(
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/expired' },
    (async () => new Response(JSON.stringify(ecsCredentialResponse({
      Expiration: '2026-08-19T21:00:20.000Z'
    })), { status: 200 })) as typeof fetch,
    () => new Date(NOW)
  );
  await assert.rejects(expired.resolve(), /expired or too close to expiry/);

  const malformed = new EcsTaskRoleObjectStorageCredentialProvider(
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/malformed' },
    (async () => new Response('{not-json', { status: 200 })) as typeof fetch,
    () => new Date(NOW)
  );
  await assert.rejects(malformed.resolve(), /not valid JSON/);

  const oversized = new EcsTaskRoleObjectStorageCredentialProvider(
    { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/oversized' },
    (async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(16 * 1024 + 1) }
    })) as typeof fetch,
    () => new Date(NOW)
  );
  await assert.rejects(oversized.resolve(), /oversized/);
});

test('runtime prefers ECS relative task-role credentials and rejects caller-controlled full credential URLs', () => {
  assert.doesNotThrow(() => createEvidenceObjectStorageForRuntime({
    NODE_ENV: 'production',
    OBJECT_STORAGE_ENDPOINT: 'https://s3.me-central-1.amazonaws.com',
    OBJECT_STORAGE_REGION: 'me-central-1',
    OBJECT_STORAGE_BUCKET: 'ros-staging-evidence',
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/runtime-task'
  }));

  assert.throws(
    () => createEvidenceObjectStorageForRuntime({
      NODE_ENV: 'production',
      OBJECT_STORAGE_ENDPOINT: 'https://s3.me-central-1.amazonaws.com',
      OBJECT_STORAGE_REGION: 'me-central-1',
      OBJECT_STORAGE_BUCKET: 'ros-staging-evidence',
      AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://evil.example/credentials'
    }),
    /FULL_URI is not accepted/
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

test('readiness performs an authenticated bucket HEAD and fails closed on storage errors', async () => {
  const requests: Array<{ readonly url: string; readonly method: string }> = [];
  let status = 200;
  const adapter = new RotatingMinioEvidenceStorageAdapter({
    endpoint: 'https://evidence.example.test',
    region: 'eu-central-1',
    bucket: 'ros-evidence',
    production: false,
    credentialProvider: {
      async resolve() {
        return { accessKeyId: 'readiness-access', secretAccessKey: 'readiness-secret-material' };
      }
    },
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(null, { status });
    },
    now: () => new Date(NOW)
  });

  await adapter.checkReadiness();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, 'HEAD');
  assert.equal(new URL(requests[0]!.url).pathname, '/ros-evidence');
  assert.match(requests[0]!.url, /X-Amz-Signature=/);

  status = 503;
  await assert.rejects(adapter.checkReadiness(), /readiness failed with status 503/);
});

test('expired environment credentials fail closed', async () => {
  const provider = new EnvironmentObjectStorageCredentialProvider(
    production({ OBJECT_STORAGE_CREDENTIAL_EXPIRES_AT: '2026-08-19T21:00:20.000Z' }),
    true,
    () => new Date(NOW)
  );
  await assert.rejects(provider.resolve(), ObjectStorageRuntimeConfigurationError);
});
