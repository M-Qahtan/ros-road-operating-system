import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AtomicInMemoryReplayNonceRegistry,
  FixedWindowSourceRateLimiter,
  InMemoryProvenanceStore,
  InMemoryQuarantineStore,
  InMemoryRawEvidenceStore,
  InMemorySafetyIntentStore,
  InMemorySourceTrustRegistry,
  Sha256DigesterAdapter,
  infrastructureMetadataSimulator,
  operatorObservationSimulator,
  personReportSimulator,
  phoneMotionSimulator,
  unsupportedWearableSimulator,
  vehicleEventSimulator
} from './signal-ingestion-adapters.js';
import { MultimodalSignalIngestionService, type MultimodalSignalIngestionPorts } from './signal-ingestion.js';

function fixture(maxQueueDepth = 128) {
  const replayAdmission = new AtomicInMemoryReplayNonceRegistry();
  const sourceTrustRegistry = new InMemorySourceTrustRegistry();
  for (const sourceId of ['device-pseudonym-001', 'vehicle-pseudonym-001', 'person-pseudonym-001', 'operator-pseudonym-001', 'road-sensor-pseudonym-001']) sourceTrustRegistry.set(sourceId, 'ACTIVE');
  const tokenDigester = new Sha256DigesterAdapter();
  const provenanceStore = new InMemoryProvenanceStore();
  const quarantineStore = new InMemoryQuarantineStore();
  const rawEvidenceStore = new InMemoryRawEvidenceStore();
  const intentStore = new InMemorySafetyIntentStore();
  const rateLimiter = new FixedWindowSourceRateLimiter(100, 60_000);
  const ports: MultimodalSignalIngestionPorts = { replayAdmission, sourceTrustRegistry, tokenDigester, provenanceStore, quarantineStore, rawEvidenceStore, intentStore, rateLimiter, idFactory: tokenDigester };
  return { service: new MultimodalSignalIngestionService(ports, { maxQueueDepth, maximumAcceptedLocationAccuracyMeters: 250 }), ports, replayAdmission, sourceTrustRegistry, provenanceStore, quarantineStore, rawEvidenceStore, intentStore, rateLimiter };
}

function request(envelope: unknown, overrides: Record<string, unknown> = {}) {
  return { envelope, correlationId: 'correlation-001', traceId: 'trace-001', evaluatedAt: '2026-07-29T12:00:02.000Z', ...overrides };
}

test('accepts deterministic multimodal signals with redacted provenance', async () => {
  const { service, provenanceStore } = fixture();
  const signals = [phoneMotionSimulator(), vehicleEventSimulator(), personReportSimulator(), operatorObservationSimulator(), infrastructureMetadataSimulator()];
  for (const [index, envelope] of signals.entries()) {
    const result = await service.ingest(request(envelope, { correlationId: `correlation-${index + 1}`, traceId: `trace-${index + 1}` }));
    assert.equal(result.disposition, 'ACCEPTED');
    assert.equal(result.reasonCode, 'accepted_with_recoverable_provenance');
  }
  assert.equal(provenanceStore.records.length, 5);
  for (const record of provenanceStore.records) {
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes('replayToken'), false);
    assert.equal(serialized.includes('24.7136'), false);
    assert.equal(serialized.includes('46.6753'), false);
  }
});

test('same nonce across signal and source scopes has exactly one winner', async () => {
  const { service, sourceTrustRegistry } = fixture();
  const first = phoneMotionSimulator({ integrity: { replayToken: 'shared-nonce', signatureStatus: 'VERIFIED', clockSkewMs: 0 } });
  const second = phoneMotionSimulator({ signalId: 'signal-phone-002', sourceId: 'device-pseudonym-002', integrity: { replayToken: 'shared-nonce', signatureStatus: 'VERIFIED', clockSkewMs: 0 } });
  sourceTrustRegistry.set('device-pseudonym-002', 'ACTIVE');
  const decisions = await Promise.all([
    service.ingest(request(first, { correlationId: 'correlation-a', traceId: 'trace-a' })),
    service.ingest(request(second, { correlationId: 'correlation-b', traceId: 'trace-b' }))
  ]);
  assert.equal(decisions.filter((value) => value.disposition === 'ACCEPTED').length, 1);
  assert.equal(decisions.filter((value) => value.reasonCode === 'replay_detected').length, 1);
});

test('persistence failure aborts reservation and retry completes exactly once', async () => {
  const { service, replayAdmission, provenanceStore, intentStore } = fixture();
  provenanceStore.failNext = true;
  const signal = phoneMotionSimulator();
  const failed = await service.ingest(request(signal));
  assert.equal(failed.disposition, 'HUMAN_REVIEW');
  assert.equal(failed.reasonCode, 'accepted_signal_persistence_unavailable');
  assert.equal(replayAdmission.snapshot().length, 0);
  const retried = await service.ingest(request(signal, { correlationId: 'correlation-retry', traceId: 'trace-retry' }));
  assert.equal(retried.disposition, 'ACCEPTED');
  assert.equal(provenanceStore.records.length, 1);
  assert.equal(intentStore.records.size, 1);
  assert.equal(replayAdmission.snapshot()[0]?.state, 'COMMITTED');
});

test('partial persistence and replay commit interruption are recoverable and idempotent', async () => {
  const { service, replayAdmission, provenanceStore, intentStore } = fixture();
  intentStore.failNext = true;
  const signal = phoneMotionSimulator();
  const failed = await service.ingest(request(signal));
  assert.equal(failed.disposition, 'HUMAN_REVIEW');
  assert.equal(provenanceStore.records.length, 1);
  assert.equal(intentStore.records.size, 0);
  assert.equal(replayAdmission.snapshot().length, 0);
  replayAdmission.failNextCommit = true;
  const commitFailed = await service.ingest(request(signal, { traceId: 'trace-recovery-1' }));
  assert.equal(commitFailed.disposition, 'HUMAN_REVIEW');
  assert.equal(commitFailed.reasonCode, 'replay_commit_unavailable');
  assert.equal(intentStore.records.size, 1);
  assert.equal(replayAdmission.snapshot()[0]?.state, 'RESERVED');
  const recovered = await service.ingest(request(signal, { traceId: 'trace-recovery-2' }));
  assert.equal(recovered.disposition, 'ACCEPTED');
  assert.equal(provenanceStore.records.length, 1);
  assert.equal(intentStore.records.size, 1);
  assert.equal(replayAdmission.snapshot()[0]?.state, 'COMMITTED');
});

test('true replay after committed admission is rejected and cannot create duplicate intent', async () => {
  const { service, intentStore } = fixture();
  const signal = phoneMotionSimulator();
  assert.equal((await service.ingest(request(signal))).disposition, 'ACCEPTED');
  const duplicate = await service.ingest(request(signal, { correlationId: 'correlation-002', traceId: 'trace-002' }));
  assert.equal(duplicate.disposition, 'QUARANTINED');
  assert.equal(duplicate.reasonCode, 'replay_detected');
  assert.equal(intentStore.records.size, 1);
});

test('different envelope cannot rebind a committed nonce', async () => {
  const { service, sourceTrustRegistry } = fixture();
  const signal = phoneMotionSimulator({ integrity: { replayToken: 'global-nonce', signatureStatus: 'VERIFIED', clockSkewMs: 0 } });
  await service.ingest(request(signal));
  sourceTrustRegistry.set('device-pseudonym-002', 'ACTIVE');
  const rebound = phoneMotionSimulator({ signalId: 'signal-phone-002', sourceId: 'device-pseudonym-002', integrity: { replayToken: 'global-nonce', signatureStatus: 'VERIFIED', clockSkewMs: 0 } });
  const result = await service.ingest(request(rebound, { correlationId: 'correlation-rebind', traceId: 'trace-rebind' }));
  assert.equal(result.disposition, 'QUARANTINED');
  assert.equal(result.reasonCode, 'replay_detected');
});

test('revoked or unknown source never reaches replay reservation or ACCEPT', async () => {
  const { service, sourceTrustRegistry, replayAdmission } = fixture();
  sourceTrustRegistry.set('device-pseudonym-001', 'REVOKED');
  assert.equal((await service.ingest(request(phoneMotionSimulator()))).disposition, 'QUARANTINED');
  assert.equal(replayAdmission.snapshot().length, 0);
  sourceTrustRegistry.unavailable = true;
  assert.equal((await service.ingest(request(vehicleEventSimulator()))).disposition, 'HUMAN_REVIEW');
});

test('malformed, unsupported, invalid signature and poor location accuracy fail closed', async () => {
  const { service } = fixture();
  const candidates = [
    { envelope: { unknown: true }, reason: 'unknown_envelope_field' },
    { envelope: unsupportedWearableSimulator(), reason: 'source_payload_mismatch' },
    { envelope: phoneMotionSimulator({ integrity: { replayToken: 'bad-signature', signatureStatus: 'INVALID', clockSkewMs: 0 } }), reason: 'invalid_signature' },
    { envelope: phoneMotionSimulator({ location: { latitude: 24.7, longitude: 46.6, accuracyMeters: 500, classification: 'PRECISE_RESTRICTED' } }), reason: 'location_accuracy_below_policy' }
  ];
  for (const [index, candidate] of candidates.entries()) {
    const result = await service.ingest(request(candidate.envelope, { correlationId: `correlation-fail-${index}`, traceId: `trace-fail-${index}` }));
    assert.notEqual(result.disposition, 'ACCEPTED');
    assert.equal(result.reasonCode, candidate.reason);
  }
});

test('stale, future and missing timestamps follow temporal fail-closed policy', async () => {
  const { service } = fixture();
  const candidates = [
    phoneMotionSimulator({ occurredAt: '2026-07-29T11:00:00.000Z', receivedAt: '2026-07-29T11:00:01.000Z' }),
    phoneMotionSimulator({ signalId: 'signal-future-001', integrity: { replayToken: 'nonce-future', signatureStatus: 'VERIFIED', clockSkewMs: 0 }, occurredAt: '2026-07-29T12:10:00.000Z', receivedAt: '2026-07-29T12:10:01.000Z' }),
    { ...phoneMotionSimulator(), signalId: 'signal-missing-time', occurredAt: undefined }
  ];
  for (const [index, envelope] of candidates.entries()) assert.notEqual((await service.ingest(request(envelope, { correlationId: `correlation-time-${index}`, traceId: `trace-time-${index}` }))).disposition, 'ACCEPTED');
});

test('registry, rate limiter and raw evidence failures degrade safely', async () => {
  const { service, replayAdmission, rateLimiter, rawEvidenceStore } = fixture();
  replayAdmission.unavailable = true;
  assert.equal((await service.ingest(request(phoneMotionSimulator()))).disposition, 'HUMAN_REVIEW');
  replayAdmission.unavailable = false;
  rateLimiter.unavailable = true;
  assert.equal((await service.ingest(request(vehicleEventSimulator()))).disposition, 'HUMAN_REVIEW');
  rateLimiter.unavailable = false;
  rawEvidenceStore.failNext = true;
  const rawFailure = await service.ingest(request(personReportSimulator(), { rawEvidence: { mediaType: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) } }));
  assert.equal(rawFailure.disposition, 'HUMAN_REVIEW');
  assert.equal(rawFailure.reasonCode, 'accepted_signal_persistence_unavailable');
});

test('queue drain completes all accepted producers without stranded entries', async () => {
  const { service, sourceTrustRegistry } = fixture(16);
  for (let index = 2; index <= 8; index += 1) sourceTrustRegistry.set(`device-pseudonym-${index.toString().padStart(3, '0')}`, 'ACTIVE');
  const requests = Array.from({ length: 8 }, (_, index) => {
    const suffix = (index + 1).toString().padStart(3, '0');
    return request(phoneMotionSimulator({ signalId: `signal-phone-${suffix}`, sourceId: `device-pseudonym-${suffix}`, integrity: { replayToken: `nonce-phone-${suffix}`, signatureStatus: 'VERIFIED', clockSkewMs: 0 } }), { correlationId: `correlation-${suffix}`, traceId: `trace-${suffix}` });
  });
  const results = await Promise.all(requests.map((value) => service.enqueue(value)));
  assert.equal(results.filter((value) => value.disposition === 'ACCEPTED').length, 8);
  assert.equal(service.getQueueDepth(), 0);
});

test('bounded queue rejects overflow explicitly and never strands accepted entries', async () => {
  const { service } = fixture(1);
  const first = service.enqueue(request(phoneMotionSimulator()));
  const second = await service.enqueue(request(vehicleEventSimulator(), { correlationId: 'correlation-overflow', traceId: 'trace-overflow' }));
  assert.equal(second.disposition, 'BACKPRESSURE');
  assert.equal(second.reasonCode, 'queue_capacity_exceeded');
  assert.equal((await first).disposition, 'ACCEPTED');
  assert.equal(service.getQueueDepth(), 0);
});

test('raw evidence is stored separately and provenance contains only an opaque reference', async () => {
  const { service, rawEvidenceStore, provenanceStore } = fixture();
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const result = await service.ingest(request(phoneMotionSimulator(), { rawEvidence: { mediaType: 'application/octet-stream', bytes } }));
  assert.equal(result.disposition, 'ACCEPTED');
  assert.equal(rawEvidenceStore.objects.size, 1);
  assert.match(provenanceStore.records[0]?.rawEvidenceRef ?? '', /^raw-evidence\//);
  assert.equal(JSON.stringify(provenanceStore.records[0]).includes('9,8,7,6'), false);
});
