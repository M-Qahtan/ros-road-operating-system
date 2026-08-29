import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryIdempotencyAdapter } from '../application/local-adapters.js';
import { AuthenticatedActor } from '../application/ports.js';
import { EvidenceAccessDeniedError, EvidenceRecord, SignedObjectRequest } from '../evidence/evidence-types.js';
import { ActorResolver } from './actor-resolver.js';
import { createEvidenceHttpHandler, EvidenceHttpService } from './evidence-http.js';
import { HttpRequest } from './road-event-http.js';

const ACTOR: AuthenticatedActor = {
  actorId: '11111111-1111-4111-8111-111111111111',
  roles: ['OPERATOR'], tenantId: 'tenant-riyadh', purpose: 'INCIDENT_TRIAGE'
};
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-21T00:00:00.000Z');

class FakeEvidenceService implements EvidenceHttpService {
  accessChecks = 0;
  creates = 0;
  completes = 0;
  downloads = 0;
  deny = false;

  async assertRoadEventAccess(): Promise<void> { this.accessChecks += 1; if (this.deny) throw new EvidenceAccessDeniedError('denied'); }
  async getAuthorizedMetadata(): Promise<EvidenceRecord> { this.accessChecks += 1; if (this.deny) throw new EvidenceAccessDeniedError('denied'); return evidence(); }
  async createUploadIntent(): Promise<{ evidence: EvidenceRecord; upload: SignedObjectRequest }> {
    this.creates += 1;
    return { evidence: evidence(), upload: signed('upload') };
  }
  async completeUpload(): Promise<EvidenceRecord> { this.completes += 1; return { ...evidence(), status: 'PRESERVED' }; }
  async createDownloadRequest(_evidenceId: string, _principal: unknown, traceId: string): Promise<SignedObjectRequest> {
    assert.equal(traceId, 'trace-evidence-1');
    this.downloads += 1;
    return signed('download');
  }
}

function evidence(): EvidenceRecord {
  return {
    id: EVIDENCE_ID, roadEventId: EVENT_ID, objectKey: `road-events/${EVENT_ID}/evidence/${EVIDENCE_ID}/photo.jpg`,
    originalFilename: 'photo.jpg', contentType: 'image/jpeg', declaredSizeBytes: 12,
    declaredChecksumSha256: 'a'.repeat(64), status: 'PENDING_UPLOAD',
    uploadExpiresAt: new Date(NOW.getTime() + 60_000), retention: { retainUntil: new Date(NOW.getTime() + 86_400_000), legalHold: false },
    createdBy: ACTOR.actorId, createdAt: NOW
  };
}

function signed(kind: string): SignedObjectRequest {
  return { url: `https://objects.example/${kind}`, expiresAt: new Date(NOW.getTime() + 60_000), requiredHeaders: {} };
}

function resolver(actor: AuthenticatedActor = ACTOR): ActorResolver { return { resolve: async () => actor }; }

function request(path: string, key = 'idem-evidence-0001'): HttpRequest {
  return {
    method: 'POST', path, query: {}, traceId: 'trace-evidence-1',
    headers: { authorization: 'Bearer verified', 'idempotency-key': key },
    body: {
      filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 12,
      checksumSha256: 'a'.repeat(64), retainUntil: '2026-08-22T00:00:00.000Z', legalHold: false
    }
  };
}

test('upload intent authorizes before every replay lookup', async () => {
  const service = new FakeEvidenceService();
  const handler = createEvidenceHttpHandler(service, new MemoryIdempotencyAdapter(), resolver(), () => NOW);
  const input = request(`/api/v1/road-events/${EVENT_ID}/evidence/upload-intents`);
  assert.equal((await handler(input))?.status, 201);
  assert.equal((await handler(input))?.status, 201);
  assert.equal(service.accessChecks, 2);
  assert.equal(service.creates, 1);
});

test('changed authorization blocks a previously cached upload result', async () => {
  const service = new FakeEvidenceService();
  const handler = createEvidenceHttpHandler(service, new MemoryIdempotencyAdapter(), resolver(), () => NOW);
  const input = request(`/api/v1/road-events/${EVENT_ID}/evidence/upload-intents`);
  assert.equal((await handler(input))?.status, 201);
  service.deny = true;
  assert.equal((await handler(input))?.status, 403);
  assert.equal(service.creates, 1);
});

test('auditor cannot create or complete evidence but can request an authorized download', async () => {
  const service = new FakeEvidenceService();
  const auditor = { ...ACTOR, roles: ['AUDITOR'] as const };
  const handler = createEvidenceHttpHandler(service, new MemoryIdempotencyAdapter(), resolver(auditor), () => NOW);
  assert.equal((await handler(request(`/api/v1/road-events/${EVENT_ID}/evidence/upload-intents`)))?.status, 403);
  assert.equal((await handler(request(`/api/v1/evidence/${EVIDENCE_ID}/complete`)))?.status, 403);
  assert.equal((await handler(request(`/api/v1/evidence/${EVIDENCE_ID}/download-intents`)))?.status, 200);
  assert.equal(service.downloads, 1);
});

test('download intent authorizes before replay and creates one audited service result', async () => {
  const service = new FakeEvidenceService();
  const handler = createEvidenceHttpHandler(service, new MemoryIdempotencyAdapter(), resolver(), () => NOW);
  const input = request(`/api/v1/evidence/${EVIDENCE_ID}/download-intents`, 'idem-evidence-download');
  assert.equal((await handler(input))?.status, 200);
  assert.equal((await handler(input))?.status, 200);
  assert.equal(service.accessChecks, 2);
  assert.equal(service.downloads, 1);
  service.deny = true;
  assert.equal((await handler(input))?.status, 403);
  assert.equal(service.downloads, 1);
});

test('complete is idempotent only after evidence scope authorization', async () => {
  const service = new FakeEvidenceService();
  const handler = createEvidenceHttpHandler(service, new MemoryIdempotencyAdapter(), resolver(), () => NOW);
  const input = request(`/api/v1/evidence/${EVIDENCE_ID}/complete`, 'idem-evidence-complete');
  assert.equal((await handler(input))?.status, 200);
  assert.equal((await handler(input))?.status, 200);
  assert.equal(service.accessChecks, 2);
  assert.equal(service.completes, 1);
});

test('unrelated paths are not consumed by the evidence handler', async () => {
  const handler = createEvidenceHttpHandler(new FakeEvidenceService(), new MemoryIdempotencyAdapter(), resolver(), () => NOW);
  assert.equal(await handler(request('/api/v1/road-events')), undefined);
});
