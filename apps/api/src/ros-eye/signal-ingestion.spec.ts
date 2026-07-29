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

function fixture() {
  const replayRegistry = new AtomicInMemoryReplayNonceRegistry();
  const sourceTrustRegistry = new InMemorySourceTrustRegistry();
  for (const sourceId of ['device-pseudonym-001', 'vehicle-pseudonym-001', 'person-pseudonym-001', 'operator-pseudonym-001', 'road-sensor-pseudonym-001']) sourceTrustRegistry.set(sourceId, 'ACTIVE');
  const tokenDigester = new Sha256DigesterAdapter();
  const provenanceStore = new InMemoryProvenanceStore();
  const quarantineStore = new InMemoryQuarantineStore();
  const rawEvidenceStore = new InMemoryRawEvidenceStore();
  const intentStore = new InMemorySafetyIntentStore();
  const rateLimiter = new FixedWindowSourceRateLimiter(10, 60_000);
  const ports: MultimodalSignalIngestionPorts = { replayRegistry, sourceTrustRegistry, tokenDigester, provenanceStore, quarantineStore, rawEvidenceStore, intentStore, rateLimiter, idFactory: tokenDigester };
  return { service: new MultimodalSignalIngestionService(ports), ports, replayRegistry, sourceTrustRegistry, provenanceStore, quarantineStore, rawEvidenceStore, intentStore, rateLimiter };
}

function request(envelope: unknown, overrides: Record<string, unknown> = {}) {
  return {
    envelope,
    correlationId: 'correlation-001',
    traceId: 'trace-001',
    evaluatedAt: '2026-07-29T12:00:02.000Z',
    ...overrides
  };
}

test('accepts deterministic phone, vehicle, person, operator and infrastructure signals with provenance', async () => {
  const { service, provenanceStore } = fixture();
  const signals = [phoneMotionSimulator(), vehicleEventSimulator(), personReportSimulator(), operatorObservationSimulator(), infrastructureMetadataSimulator()];
  for (const [index, envelope] of signals.entries()) {
    const result = await service.ingest(request(envelope, { correlationId: `correlation-${index + 1}`, traceId: `trace-${index + 1}` }));
    assert.equal(result.disposition, 'ACCEPTED');
    assert.equal(result.reasonCode, 'accepted_with_provenance');
  }
  assert.equal(provenanceStore.records.length, 5);
  for (const record of provenanceStore.records) {
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes('replayToken'), false);
    assert.equal(serialized.includes('24.7136'), false);
    assert.equal(serialized.includes('46.6753'), false);
    assert.equal(record.auditOutcome, 'ACCEPTED');
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

test('duplicate signal cannot create duplicate safety intent', async () => {
  const { service, intentStore } = fixture();
  const signal = phoneMotionSimulator();
  const first = await service.ingest(request(signal));
  const duplicate = await service.ingest(request(signal, { correlationId: 'correlation-002', traceId: 'trace-002' }));
  assert.equal(first.disposition, 'ACCEPTED');
  assert.equal(duplicate.reasonCode, 'replay_detected');
  assert.equal(intentStore.records.size, 1);
});

test('revoked or unknown source never reaches replay consume or ACCEPT', async () => {
  const { service, sourceTrustRegistry, replayRegistry } = fixture();
  sourceTrustRegistry.set('device-pseudonym-001', 'REVOKED');
  const revoked = await service.ingest(request(phoneMotionSimulator()));
  assert.equal(revoked.disposition, 'QUARANTINED');
  assert.equal(revoked.reasonCode, 'source_revoked');
  assert.equal(replayRegistry.snapshot().length, 0);
  sourceTrustRegistry.unavailable = true;
  const unavailable = await service.ingest(request(vehicleEventSimulator()));
  assert.equal(unavailable.disposition, 'HUMAN_REVIEW');
  assert.equal(unavailable.reasonCode, 'source_trust_unavailable');
});

test('malformed, unsupported wearable, bad signature and poor location accuracy fail closed', async () => {
  const { service } = fixture();
  const candidates = [
    { envelope: { unknown: true }, reason: 'invalid_envelope' },
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
  for (const [index, envelope] of candidates.entries()) {
    const result = await service.ingest(request(envelope, { correlationId: `correlation-time-${index}`, traceId: `trace-time-${index}` }));
    assert.notEqual(result.disposition, 'ACCEPTED');
  }
});

test('registry, rate limiter and raw evidence store failures degrade safely', async () => {
  const { service, replayRegistry, rateLimiter, rawEvidenceStore } = fixture();
  replayRegistry.unavailable = true;
  const registry = await service.ingest(request(phoneMotionSimulator()));
  assert.equal(registry.disposition, 'HUMAN_REVIEW');
  assert.equal(registry.reasonCode, 'replay_registry_unavailable');

  replayRegistry.unavailable = false;
  rateLimiter.unavailable = true;
  const limited = await service.ingest(request(vehicleEventSimulator()));
  assert.equal(limited.disposition, 'HUMAN_REVIEW');
  assert.equal(limited.reasonCode, 'rate_limiter_unavailable');

  rateLimiter.unavailable = false;
  rawEvidenceStore.unavailable = true;
  const rawFailure = await service.ingest(request(personReportSimulator(), { rawEvidence: { mediaType: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) } }));
  assert.equal(rawFailure.disposition, 'HUMAN_REVIEW');
  assert.equal(rawFailure.reasonCode, 'raw_evidence_store_unavailable');
});

test('per-source rate limiting and bounded queue produce explicit backpressure', async () => {
  const base = fixture();
  const rateLimitedPorts = { ...base.ports, rateLimiter: new FixedWindowSourceRateLimiter(1, 60_000) };
  const rateLimitedService = new MultimodalSignalIngestionService(rateLimitedPorts);
  const first = await rateLimitedService.ingest(request(phoneMotionSimulator()));
  const second = await rateLimitedService.ingest(request(phoneMotionSimulator({ signalId: 'signal-phone-002', integrity: { replayToken: 'nonce-phone-002', signatureStatus: 'VERIFIED', clockSkewMs: 0 } }), { correlationId: 'correlation-002', traceId: 'trace-002' }));
  assert.equal(first.disposition, 'ACCEPTED');
  assert.equal(second.disposition, 'BACKPRESSURE');
  assert.equal(second.reasonCode, 'source_rate_limited');
  assert.equal(rateLimitedService.getReadiness(), 'DEGRADED');
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
