import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import {
  IntegrationLifecycleError,
  IntegrationSourceSnapshot,
  PostgresIntegrationSandbox,
  TrustedIntegrationProfile
} from '../integrations/integration-lifecycle.js';

const TRAFFIC_PROFILE: TrustedIntegrationProfile = {
  profileId: 'traffic-sandbox.riyadh',
  partner: 'TRAFFIC',
  purpose: 'TRAFFIC_COORDINATION',
  tenantId: 'riyadh-pilot',
  mode: 'SIMULATION_ONLY'
};
const INSURANCE_PROFILE: TrustedIntegrationProfile = {
  profileId: 'insurance-sandbox.riyadh',
  partner: 'INSURANCE',
  purpose: 'INSURANCE_COORDINATION',
  tenantId: 'riyadh-pilot',
  mode: 'SIMULATION_ONLY'
};

function source(roadEventId: string): IntegrationSourceSnapshot {
  return {
    roadEventId,
    tenantId: 'riyadh-pilot',
    occurredAt: '2026-08-20T02:00:00.000Z',
    location: { latitude: 24.7136, longitude: 46.6753 },
    severity: { level: 'S3', score: 82, reasonCodes: ['collision', 'lane_blocked'] },
    humanSafety: { status: 'NEEDS_HELP', responseRequired: true },
    road: { segmentId: 'riyadh-segment-runtime-17', lanesBlocked: 2, closureState: 'RESTRICTED' },
    vehicle: { vehicleClass: 'PASSENGER_CAR', mobility: 'DISABLED' },
    insurance: { policyReference: 'policy-reference-runtime' },
    personal: { contactReference: 'private-contact-reference', identityReference: 'private-identity-reference' },
    evidenceRefs: ['private-evidence-reference']
  };
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const operationId = `operation-${suffix}`;
  const idempotencyKey = `integration-idempotency-${suffix}-0001`;
  const roadEventId = `road-event-${suffix}`;
  const preparedAt = '2026-08-20T02:01:00.000Z';
  const sentAt = '2026-08-20T02:01:10.000Z';

  try {
    await postgres.verifyConnection();
    const sandbox = new PostgresIntegrationSandbox(postgres);
    const prepareInput = {
      logicalOperationId: operationId,
      requestId: `request-${suffix}`,
      idempotencyKey,
      correlationId: `correlation-${suffix}`,
      causationId: `causation-${suffix}`,
      source: source(roadEventId),
      preparedAt
    } as const;

    const prepared = await sandbox.prepare(TRAFFIC_PROFILE, prepareInput);
    const projectionText = JSON.stringify(prepared.projection);
    assert.equal(projectionText.includes('private-contact-reference'), false);
    assert.equal(projectionText.includes('private-identity-reference'), false);
    assert.equal(projectionText.includes('private-evidence-reference'), false);
    assert.equal(projectionText.includes('reasonCodes'), false);
    assert.equal(projectionText.includes('score'), false);

    const restartedBeforeSend = new PostgresIntegrationSandbox(postgres);
    const replayedPrepare = await restartedBeforeSend.prepare(TRAFFIC_PROFILE, {
      ...prepareInput,
      preparedAt: '2026-08-20T02:01:05.000Z'
    });
    assert.deepEqual(replayedPrepare, prepared);

    await assert.rejects(
      sandbox.prepare(TRAFFIC_PROFILE, {
        ...prepareInput,
        logicalOperationId: `operation-conflict-${suffix}`,
        source: source(`road-event-conflict-${suffix}`)
      }),
      /reused with different semantics|conflicts with another delivery/
    );

    const [firstReceipt, concurrentReceipt] = await Promise.all([
      sandbox.send(TRAFFIC_PROFILE, operationId, sentAt),
      restartedBeforeSend.send(TRAFFIC_PROFILE, operationId, sentAt)
    ]);
    assert.deepEqual(concurrentReceipt, firstReceipt);

    const restartedAfterSend = new PostgresIntegrationSandbox(postgres);
    const restartReceipt = await restartedAfterSend.send(
      TRAFFIC_PROFILE,
      operationId,
      '2026-08-20T02:01:20.000Z'
    );
    assert.deepEqual(restartReceipt, firstReceipt);

    const stateAfterSend = await restartedAfterSend.status(TRAFFIC_PROFILE, firstReceipt.providerRequestId);
    assert.equal(stateAfterSend.state, 'ACCEPTED');
    assert.equal(stateAfterSend.attemptCount, 1);
    assert.equal(stateAfterSend.acceptedAt, firstReceipt.acceptedAt);
    assert.equal(stateAfterSend.simulationOnly, true);

    await assert.rejects(
      restartedAfterSend.status(INSURANCE_PROFILE, firstReceipt.providerRequestId),
      /Integration delivery was not found/
    );

    const acknowledged = await sandbox.handleCallback(TRAFFIC_PROFILE, {
      callbackId: `callback-ack-${suffix}`,
      providerRequestId: firstReceipt.providerRequestId,
      state: 'ACKNOWLEDGED',
      occurredAt: '2026-08-20T02:02:00.000Z'
    });
    assert.equal(acknowledged.state, 'ACKNOWLEDGED');

    const duplicateAcknowledgement = await sandbox.handleCallback(TRAFFIC_PROFILE, {
      callbackId: `callback-ack-${suffix}`,
      providerRequestId: firstReceipt.providerRequestId,
      state: 'ACKNOWLEDGED',
      occurredAt: '2026-08-20T02:02:00.000Z'
    });
    assert.deepEqual(duplicateAcknowledgement, acknowledged);

    await assert.rejects(
      sandbox.handleCallback(TRAFFIC_PROFILE, {
        callbackId: `callback-ack-${suffix}`,
        providerRequestId: firstReceipt.providerRequestId,
        state: 'FAILED',
        reason: 'semantic replay mutation',
        occurredAt: '2026-08-20T02:02:00.000Z'
      }),
      /Callback id was replayed with different semantics/
    );

    await assert.rejects(
      sandbox.handleCallback(TRAFFIC_PROFILE, {
        callbackId: `callback-late-${suffix}`,
        providerRequestId: firstReceipt.providerRequestId,
        state: 'COMPLETED',
        occurredAt: '2026-08-20T02:01:59.000Z'
      }),
      /Callback timestamp is older than current delivery state/
    );

    const completed = await sandbox.handleCallback(TRAFFIC_PROFILE, {
      callbackId: `callback-complete-${suffix}`,
      providerRequestId: firstReceipt.providerRequestId,
      state: 'COMPLETED',
      occurredAt: '2026-08-20T02:03:00.000Z'
    });
    assert.equal(completed.state, 'COMPLETED');

    const repeatedTerminal = await sandbox.handleCallback(TRAFFIC_PROFILE, {
      callbackId: `callback-complete-repeat-${suffix}`,
      providerRequestId: firstReceipt.providerRequestId,
      state: 'COMPLETED',
      occurredAt: '2026-08-20T02:04:00.000Z'
    });
    assert.equal(repeatedTerminal.state, 'COMPLETED');
    assert.equal(repeatedTerminal.updatedAt, completed.updatedAt);

    await assert.rejects(
      sandbox.handleCallback(TRAFFIC_PROFILE, {
        callbackId: `callback-terminal-regression-${suffix}`,
        providerRequestId: firstReceipt.providerRequestId,
        state: 'FAILED',
        reason: 'late conflicting terminal result',
        occurredAt: '2026-08-20T02:05:00.000Z'
      }),
      /terminal COMPLETED/
    );

    const postCompletionSendReplay = await sandbox.send(
      TRAFFIC_PROFILE,
      operationId,
      '2026-08-20T02:06:00.000Z'
    );
    assert.deepEqual(postCompletionSendReplay, firstReceipt);

    const cancellationOperationId = `operation-cancel-${suffix}`;
    const cancellationPrepared = await sandbox.prepare(TRAFFIC_PROFILE, {
      logicalOperationId: cancellationOperationId,
      requestId: `request-cancel-${suffix}`,
      idempotencyKey: `integration-idempotency-${suffix}-cancel`,
      correlationId: `correlation-cancel-${suffix}`,
      causationId: `causation-cancel-${suffix}`,
      source: source(`road-event-cancel-${suffix}`),
      preparedAt
    });
    assert.equal(cancellationPrepared.logicalOperationId, cancellationOperationId);
    const cancellationReceipt = await sandbox.send(
      TRAFFIC_PROFILE,
      cancellationOperationId,
      sentAt
    );
    const cancelled = await sandbox.cancel(
      TRAFFIC_PROFILE,
      cancellationReceipt.providerRequestId,
      'operator simulation cancellation',
      '2026-08-20T02:02:30.000Z'
    );
    assert.equal(cancelled.state, 'CANCELLED');
    assert.deepEqual(
      await sandbox.cancel(
        TRAFFIC_PROFILE,
        cancellationReceipt.providerRequestId,
        'operator simulation cancellation',
        '2026-08-20T02:03:30.000Z'
      ),
      cancelled
    );
    await assert.rejects(
      sandbox.cancel(
        TRAFFIC_PROFILE,
        cancellationReceipt.providerRequestId,
        'changed cancellation reason',
        '2026-08-20T02:03:30.000Z'
      ),
      /Cancellation replay changed its reason/
    );
    await assert.rejects(
      sandbox.handleCallback(TRAFFIC_PROFILE, {
        callbackId: `callback-after-cancel-${suffix}`,
        providerRequestId: cancellationReceipt.providerRequestId,
        state: 'ACKNOWLEDGED',
        occurredAt: '2026-08-20T02:04:00.000Z'
      }),
      /terminal CANCELLED/
    );

    const db = await postgres.connect();
    let callbackAppendOnlyVerified = false;
    let deliveryTerminalGuardVerified = false;
    let providerIdentityImmutableVerified = false;
    try {
      const delivery = await db.query<{
        attempt_count: number;
        state: string;
        provider_request_id: string;
        accepted_at: Date | string;
      }>(
        `SELECT attempt_count, state, provider_request_id, accepted_at
           FROM integration_deliveries
          WHERE logical_operation_id = $1`,
        [operationId]
      );
      assert.equal(delivery.rowCount, 1);
      assert.equal(delivery.rows[0]?.attempt_count, 1);
      assert.equal(delivery.rows[0]?.state, 'COMPLETED');
      assert.equal(delivery.rows[0]?.provider_request_id, firstReceipt.providerRequestId);
      assert.equal(new Date(delivery.rows[0]!.accepted_at).toISOString(), firstReceipt.acceptedAt);

      try {
        await db.query(
          `UPDATE integration_delivery_callbacks
              SET semantic_fingerprint = repeat('0', 64)
            WHERE profile_id = $1 AND callback_id = $2`,
          [TRAFFIC_PROFILE.profileId, `callback-ack-${suffix}`]
        );
      } catch (error) {
        callbackAppendOnlyVerified = error instanceof Error && /append-only/.test(error.message);
      }

      try {
        await db.query(
          `UPDATE integration_deliveries SET state = 'ACCEPTED'
            WHERE logical_operation_id = $1`,
          [operationId]
        );
      } catch (error) {
        deliveryTerminalGuardVerified = error instanceof Error && /terminal integration delivery state is immutable/.test(error.message);
      }

      try {
        await db.query(
          `UPDATE integration_deliveries SET provider_request_id = $2
            WHERE logical_operation_id = $1`,
          [operationId, `sim-mutated-${suffix}`]
        );
      } catch (error) {
        providerIdentityImmutableVerified = error instanceof Error && /provider request identity is immutable/.test(error.message);
      }
    } finally {
      db.release();
    }

    assert.equal(callbackAppendOnlyVerified, true);
    assert.equal(deliveryTerminalGuardVerified, true);
    assert.equal(providerIdentityImmutableVerified, true);

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      simulationOnly: true,
      minimumNecessaryProjectionVerified: true,
      persistentPrepareIdempotencyVerified: true,
      semanticIdempotencyConflictRejected: true,
      concurrentSendExactlyOneLogicalActionVerified: true,
      sendAttemptCount: 1,
      restartReceiptReplayVerified: true,
      crossProfileStatusIsolationVerified: true,
      callbackReplaySemanticsVerified: true,
      delayedCallbackRejected: true,
      terminalStateGuardVerified: true,
      callbackAppendOnlyVerified: true,
      providerIdentityImmutableVerified: true,
      cancellationIdempotencyVerified: true,
      networkCalls: 0,
      operationalAuthorityGranted: false
    }) + '\n');
  } catch (error) {
    if (error instanceof IntegrationLifecycleError) throw error;
    throw error;
  } finally {
    await postgres.close();
  }
}

await run();
