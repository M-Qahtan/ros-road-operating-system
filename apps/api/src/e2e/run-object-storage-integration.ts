import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RoadEvent } from '@ros/domain';
import { createEvidenceServiceForRuntime } from '../evidence/evidence-runtime.js';
import { EvidenceNotFoundError } from '../evidence/evidence-types.js';
import { SafeLocalMalwareScanner } from '../evidence/safe-local-malware-scanner.js';
import { createNodePostgresPool } from '../persistence/postgres/pg-postgres-pool.js';
import { PostgresRoadEventRepository } from '../persistence/postgres/postgres-road-event-repository.js';

const ROAD_EVENT_ID = '81000000-0000-4000-8000-000000000001';
const ACTOR_ID = '81000000-0000-4000-8000-000000000002';
const TRACE_ID = '81000000-0000-4000-8000-000000000003';
const TENANT_ID = 'object-storage-integration';
const PURPOSE = 'ROAD_SAFETY_OPERATIONS';
const CONTENT_TYPE = 'application/json';
const BODY = JSON.stringify({ source: 'ros-evidence-runtime-integration', safe: true });
const CHECKSUM = createHash('sha256').update(BODY, 'utf8').digest('hex');

async function requireOk(response: Response, operation: string): Promise<Response> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${operation} failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return response;
}

async function run(): Promise<void> {
  const postgres = createNodePostgresPool(process.env);
  try {
    await postgres.verifyConnection();
    const roadEvents = new PostgresRoadEventRepository(postgres);
    await roadEvents.create(new RoadEvent({
      id: ROAD_EVENT_ID,
      occurredAt: new Date('2026-08-19T20:00:00.000Z'),
      latitude: 24.7136,
      longitude: 46.6753
    }), {
      tenantId: TENANT_ID,
      purpose: PURPOSE,
      actorType: 'SYSTEM',
      action: 'object_storage_integration.road_event_created',
      traceId: TRACE_ID,
      eventType: 'ObjectStorageIntegrationRoadEventCreated',
      correlationId: ROAD_EVENT_ID
    });

    const service = createEvidenceServiceForRuntime(process.env, {
      postgres,
      roadEvents,
      malwareScanner: new SafeLocalMalwareScanner()
    });
    const principal = { actorId: ACTOR_ID, tenantId: TENANT_ID, purpose: PURPOSE } as const;
    const wrongTenant = { actorId: ACTOR_ID, tenantId: 'other-tenant', purpose: PURPOSE } as const;

    const intent = await service.createUploadIntent({
      roadEventId: ROAD_EVENT_ID,
      principal,
      traceId: TRACE_ID,
      filename: 'runtime-proof.json',
      contentType: CONTENT_TYPE,
      sizeBytes: Buffer.byteLength(BODY, 'utf8'),
      checksumSha256: CHECKSUM,
      retention: {
        retainUntil: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000),
        legalHold: false
      }
    });

    await requireOk(await fetch(intent.upload.url, {
      method: 'PUT',
      headers: { ...intent.upload.requiredHeaders },
      body: BODY
    }), 'EvidenceService presigned PUT');

    const completed = await service.completeUpload(intent.evidence.id, principal, TRACE_ID);
    assert.equal(completed.status, 'PRESERVED');
    assert.equal(completed.verifiedChecksumSha256, CHECKSUM);

    const download = await service.createDownloadRequest(intent.evidence.id, principal);
    const downloaded = await requireOk(await fetch(download.url), 'EvidenceService presigned GET');
    assert.equal(await downloaded.text(), BODY);

    await assert.rejects(
      service.createDownloadRequest(intent.evidence.id, wrongTenant),
      EvidenceNotFoundError
    );

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      postgresEvidencePersisted: true,
      roadEventScopeVerified: true,
      uploadChecksumVerified: true,
      downloadVerified: true,
      crossTenantEvidenceHidden: true
    }) + '\n');
  } finally {
    await postgres.close();
  }
}

await run();
