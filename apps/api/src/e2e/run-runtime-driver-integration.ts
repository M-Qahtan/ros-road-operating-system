import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { RoadEventNotFoundError, SeverityLevel } from '@ros/domain';
import { createNodeRedisStreamClient } from '../messaging/node-redis-stream-client.js';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { createPersistentRoadEventApplication } from '../runtime/runtime-composition.js';
import { createOutboxWorkerRuntime } from '../runtime/outbox-worker-runtime.js';

const OUTBOX_ID = '81111111-1111-4111-8111-111111111111';
const AGGREGATE_ID = '82222222-2222-4222-8222-222222222222';
const CORRELATION_ID = '83333333-3333-4333-8333-333333333333';
const RUNTIME_OUTBOX_SCOPE = { tenantId: 'runtime-proof-tenant', purpose: 'road-safety-response' } as const;
const ABAC_EVENT_ID = '84444444-4444-4444-8444-444444444444';
const ABAC_ACTOR_ID = '85555555-5555-4555-8555-555555555555';
const ABAC_SIGNAL_ID = '86666666-6666-4666-8666-666666666666';
const ABAC_TRACE_ID = '87777777-7777-4777-8777-777777777777';
const ABAC_SCOPE = { tenantId: 'abac-proof-tenant-a', purpose: 'road-safety-response' } as const;
const STREAM = process.env.ROS_OUTBOX_STREAM ?? 'ros:integration-events';

interface PublishedRow {
  readonly published_at: Date | string | null;
  readonly locked_by: string | null;
  readonly locked_until: Date | string | null;
  readonly retry_count: number;
  readonly dead_lettered_at: Date | string | null;
}

function requiredRedisUrl(): string {
  const value = process.env.REDIS_URL?.trim();
  if (!value) throw new Error('REDIS_URL is required for runtime driver integration');
  return value;
}

function runChildProof(scriptName: string): string {
  const script = fileURLToPath(new URL(`./${scriptName}`, import.meta.url));
  const output = execFileSync(process.execPath, [script], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  process.stdout.write(output);
  return output;
}

function proveRuntimeResilience(): void {
  const output = runChildProof('run-runtime-resilience-integration.js');
  assert.match(output, /"status":"PASS"/);
  assert.match(output, /"outboxUniqueDeliveryVerified":true/);
  assert.match(output, /"workerRestartRecoveryVerified":true/);
  assert.match(output, /"activeLeaseFencingVerified":true/);
  assert.match(output, /"crashReservationFailClosedVerified":true/);
  assert.match(output, /"committedWithoutReplayFailClosedVerified":true/);
  assert.match(output, /"reconciliationAlertVerified":true/);
  assert.match(output, /"completedReplaySurvivesRestart":true/);
  assert.match(output, /"exactFenceReconciliationVerified":true/);
}

function proveCallbackReplay(): void {
  const output = runChildProof('run-callback-replay-integration.js');
  assert.match(output, /"status":"PASS"/);
  assert.match(output, /"callbackSignatureVerified":true/);
  assert.match(output, /"requestCannotOverrideProfileVerified":true/);
  assert.match(output, /"sameProfileReplayRejected":true/);
  assert.match(output, /"crossProfileSignatureBindingVerified":true/);
  assert.match(output, /"profileScopedNonceReuseVerified":true/);
  assert.match(output, /"nonceImmutabilityVerified":true/);
}

function provePartnerLifecycle(): void {
  const output = runChildProof('run-partner-lifecycle-integration.js');
  assert.match(output, /"status":"PASS"/);
  assert.match(output, /"simulationOnly":true/);
  assert.match(output, /"minimumNecessaryProjectionVerified":true/);
  assert.match(output, /"persistentPrepareIdempotencyVerified":true/);
  assert.match(output, /"semanticIdempotencyConflictRejected":true/);
  assert.match(output, /"exactTrustedProfileBindingVerified":true/);
  assert.match(output, /"concurrentSendExactlyOneLogicalActionVerified":true/);
  assert.match(output, /"sendAttemptCount":1/);
  assert.match(output, /"restartReceiptReplayVerified":true/);
  assert.match(output, /"crossProfileStatusIsolationVerified":true/);
  assert.match(output, /"callbackReplaySemanticsVerified":true/);
  assert.match(output, /"delayedCallbackRejected":true/);
  assert.match(output, /"terminalStateGuardVerified":true/);
  assert.match(output, /"callbackAppendOnlyVerified":true/);
  assert.match(output, /"providerIdentityImmutableVerified":true/);
  assert.match(output, /"cancellationIdempotencyVerified":true/);
  assert.match(output, /"networkCalls":0/);
  assert.match(output, /"operationalAuthorityGranted":false/);
}

function provePartnerTrust(): void {
  const output = runChildProof('run-partner-trust-integration.js');
  assert.match(output, /"status":"PASS"/);
  assert.match(output, /"sandboxOnlyVerified":true/);
  assert.match(output, /"mtlsCertificatePinVerified":true/);
  assert.match(output, /"detachedJwsRs256Verified":true/);
  assert.match(output, /"protectedScopeBindingVerified":true/);
  assert.match(output, /"bodyTamperRejected":true/);
  assert.match(output, /"keyRotationOverlapVerified":true/);
  assert.match(output, /"expiredOldKeyRejected":true/);
  assert.match(output, /"revokedKeyRejected":true/);
  assert.match(output, /"networkCalls":0/);
  assert.match(output, /"productionActivationEnabled":false/);
}

async function assertRoadEventAbac(postgres: ReturnType<typeof createNodePostgresPool>): Promise<void> {
  const application = createPersistentRoadEventApplication(postgres);
  const operator = { actorId: ABAC_ACTOR_ID, roles: ['OPERATOR'] as const, ...ABAC_SCOPE };
  const auditor = { actorId: ABAC_ACTOR_ID, roles: ['AUDITOR'] as const, ...ABAC_SCOPE };

  const created = await application.create({
    id: ABAC_EVENT_ID,
    occurredAt: '2026-08-19T23:00:00.000Z',
    latitude: 24.7136,
    longitude: 46.6753
  }, {
    actor: operator,
    traceId: ABAC_TRACE_ID,
    idempotencyKey: 'abac-create-0001'
  });
  assert.equal(created.id, ABAC_EVENT_ID);

  const sameScope = await application.getById(ABAC_EVENT_ID, operator);
  assert.equal(sameScope.id, ABAC_EVENT_ID);

  const correctPage = await application.list({ limit: 20, offset: 0 }, operator);
  assert.equal(correctPage.total, 1);
  assert.equal(correctPage.items[0]?.id, ABAC_EVENT_ID);

  const wrongTenant = { ...operator, tenantId: 'abac-proof-tenant-b' };
  const wrongPurpose = { ...operator, purpose: 'analytics-only' };
  const wrongPurposeAuditor = { ...auditor, purpose: 'analytics-only' };

  await assert.rejects(application.getById(ABAC_EVENT_ID, wrongTenant), RoadEventNotFoundError);
  await assert.rejects(application.getById(ABAC_EVENT_ID, wrongPurpose), RoadEventNotFoundError);

  const wrongTenantPage = await application.list({ limit: 20, offset: 0 }, wrongTenant);
  const wrongPurposePage = await application.list({ limit: 20, offset: 0 }, wrongPurpose);
  assert.equal(wrongTenantPage.total, 0);
  assert.equal(wrongPurposePage.total, 0);

  await assert.rejects(
    application.reassessSeverity({
      roadEventId: ABAC_EVENT_ID,
      expectedVersion: 1,
      assessment: {
        level: SeverityLevel.Moderate,
        score: 45,
        confidence: 0.8,
        reasonCodes: ['abac_negative_probe'],
        requiresHumanReview: true
      },
      reason: 'cross-tenant update must be hidden'
    }, {
      actor: wrongTenant,
      traceId: ABAC_TRACE_ID,
      idempotencyKey: 'abac-update-0001'
    }),
    RoadEventNotFoundError
  );

  await assert.rejects(application.timeline(ABAC_EVENT_ID, wrongPurposeAuditor), RoadEventNotFoundError);

  await assert.rejects(
    application.attachSignal({
      roadEventId: ABAC_EVENT_ID,
      signalId: ABAC_SIGNAL_ID,
      matchScore: 0.9,
      mergeReasons: ['abac_negative_probe']
    }, {
      actor: wrongTenant,
      traceId: ABAC_TRACE_ID,
      idempotencyKey: 'abac-signal-0001'
    }),
    RoadEventNotFoundError
  );

  const finalState = await application.getById(ABAC_EVENT_ID, operator);
  assert.equal(finalState.version, 1);
  assert.equal(finalState.severity.level, SeverityLevel.Informational);
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  const redis = createNodeRedisStreamClient(process.env);
  const redisVerifier = createClient({
    url: requiredRedisUrl(),
    disableOfflineQueue: true
  });
  redisVerifier.on('error', () => {});

  try {
    await postgres.verifyConnection();
    await redis.connect();
    await redisVerifier.connect();
    await redisVerifier.del(STREAM);

    const client = await postgres.connect();
    try {
      await client.query(`DELETE FROM outbox_events WHERE id = $1::uuid`, [OUTBOX_ID]);
      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload,
           correlation_id, tenant_id, purpose, occurred_at
         ) VALUES ($1::uuid, 'RoadEvent', $2::uuid, 'RoadEventCreated',
                   $3::jsonb, $4::uuid, $5, $6, now())`,
        [
          OUTBOX_ID,
          AGGREGATE_ID,
          { source: 'runtime-driver-integration' },
          CORRELATION_ID,
          RUNTIME_OUTBOX_SCOPE.tenantId,
          RUNTIME_OUTBOX_SCOPE.purpose
        ]
      );
    } finally {
      client.release();
    }

    const worker = createOutboxWorkerRuntime(postgres, redis, process.env);
    const result = await worker.runOnce();
    assert.deepEqual(result, { claimed: 1, published: 1, retried: 0, deadLettered: 0 });

    const verificationClient = await postgres.connect();
    let row: PublishedRow | undefined;
    try {
      const query = await verificationClient.query<PublishedRow>(
        `SELECT published_at, locked_by, locked_until, retry_count, dead_lettered_at
           FROM outbox_events
          WHERE id = $1::uuid`,
        [OUTBOX_ID]
      );
      row = query.rows[0];
    } finally {
      verificationClient.release();
    }
    assert.ok(row?.published_at !== null && row?.published_at !== undefined);
    assert.equal(row?.locked_by, null);
    assert.equal(row?.locked_until, null);
    assert.equal(row?.retry_count, 0);
    assert.equal(row?.dead_lettered_at, null);

    const entries = await redisVerifier.xRange(STREAM, '-', '+');
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry?.message.eventId, OUTBOX_ID);
    assert.equal(entry?.message.simulationMode, 'false');
    assert.equal(entry?.message.deliveryMode, 'runtime');
    assert.equal(entry?.message.tenantId, RUNTIME_OUTBOX_SCOPE.tenantId);
    assert.equal(entry?.message.purpose, RUNTIME_OUTBOX_SCOPE.purpose);

    proveRuntimeResilience();
    proveCallbackReplay();
    provePartnerLifecycle();
    provePartnerTrust();
    await assertRoadEventAbac(postgres);

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      claimed: result.claimed,
      published: result.published,
      redisStreamEntries: entries.length,
      outboxPublished: true,
      runtimeDeliveryMode: entry?.message.deliveryMode,
      outboxScopeVerified: true,
      outboxScope: RUNTIME_OUTBOX_SCOPE,
      runtimeResilienceVerified: true,
      callbackReplayVerified: true,
      partnerLifecycleVerified: true,
      partnerTrustVerified: true,
      abacIsolationVerified: true,
      abacDimensions: ['tenant', 'purpose'],
      abacNegativePaths: ['detail', 'list', 'update', 'timeline', 'signal']
    }) + '\n');
  } finally {
    if (redisVerifier.isOpen) redisVerifier.destroy();
    await Promise.allSettled([redis.close(), postgres.close()]);
  }
}

await run();
