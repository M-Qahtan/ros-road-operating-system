import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContactSessionRecord } from './contact-orchestration.js';
import {
  PostgresContactRuntimeRepository,
  type ContactSqlConnectionPort,
  type ContactSqlPoolPort,
  type ContactSqlQueryResult,
  type ContactSqlRow
} from './contact-orchestration-postgres.js';
import { contactRevisionDigest } from './contact-revision.js';
import { PostgresContactRevisionSource } from './contact-revision-source-postgres.js';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'session-001';
const SCOPE = { tenantId: 'tenant-riyadh', purpose: 'road-safety-response', caseId: CASE_ID } as const;

interface CapturedQuery { readonly text: string; readonly values: readonly unknown[]; }
type Handler = (text: string, values: readonly unknown[]) => ContactSqlQueryResult;

class FakeSql implements ContactSqlPoolPort, ContactSqlConnectionPort {
  readonly queries: CapturedQuery[] = [];
  constructor(private readonly handler: Handler) {}
  async transaction<T>(work: (connection: ContactSqlConnectionPort) => Promise<T>): Promise<T> { return work(this); }
  async query<Row extends ContactSqlRow = ContactSqlRow>(text: string, values: readonly unknown[] = []): Promise<ContactSqlQueryResult<Row>> {
    this.queries.push({ text, values });
    return this.handler(text, values) as ContactSqlQueryResult<Row>;
  }
}

function session(version = 1, state: ContactSessionRecord['state'] = 'CONSENT_PENDING'): ContactSessionRecord {
  return {
    tenantId: SCOPE.tenantId,
    caseId: CASE_ID,
    sessionId: SESSION_ID,
    ownerActorId: null,
    state,
    version,
    protocolVersion: 'ros-eye.contact.v1',
    promptPolicyVersion: 'ros-eye.contact-prompts.v1',
    accessibilityPolicyVersion: 'ros-eye.accessibility.v1',
    language: 'ar',
    identityConfidence: 'UNVERIFIED',
    activeChannel: 'IN_APP_CHAT',
    attemptCount: 1,
    responseDeadlineAt: '2026-09-08T10:02:00.000Z',
    nextActionAt: '2026-09-08T10:02:00.000Z',
    lastInteractionAt: '2026-09-08T10:00:00.000Z',
    assignedOperatorId: null,
    accessibility: {
      screenReaderRequired: true,
      handsFreeRequired: true,
      largeControlsRequired: true,
      simpleLanguageRequired: true,
      visualAlternativeRequired: true,
      audioAlternativeRequired: true
    },
    automationSuppressed: false,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: version === 1 ? '2026-09-08T10:00:00.000Z' : '2026-09-08T10:01:00.000Z'
  };
}

function sessionRow(value: ContactSessionRecord): ContactSqlRow {
  return {
    tenant_id: value.tenantId,
    case_id: value.caseId,
    session_id: value.sessionId,
    owner_actor_id: value.ownerActorId,
    state: value.state,
    version: value.version,
    protocol_version: value.protocolVersion,
    prompt_policy_version: value.promptPolicyVersion,
    accessibility_policy_version: value.accessibilityPolicyVersion,
    language: value.language,
    identity_confidence: value.identityConfidence,
    active_channel: value.activeChannel,
    attempt_count: value.attemptCount,
    response_deadline_at: value.responseDeadlineAt,
    next_action_at: value.nextActionAt,
    last_interaction_at: value.lastInteractionAt,
    assigned_operator_id: value.assignedOperatorId,
    accessibility: value.accessibility,
    automation_suppressed: value.automationSuppressed,
    lease_owner: value.leaseOwner,
    lease_expires_at: value.leaseExpiresAt,
    updated_at: value.updatedAt
  };
}

test('opening the first session derives purpose from the locked RoadEvent and appends contact revision one', async () => {
  const sql = new FakeSql((text) => {
    if (text.includes('SELECT purpose FROM road_events')) return { rows: [{ purpose: SCOPE.purpose }], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_sessions') && text.includes('ORDER BY')) return { rows: [], rowCount: 0 };
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  await new PostgresContactRuntimeRepository(sql).transaction((tx) => tx.insertSession(session()));

  const parent = sql.queries.find((query) => query.text.includes('SELECT purpose FROM road_events'))!;
  assert.deepEqual(parent.values, [SCOPE.tenantId, CASE_ID]);
  assert.match(parent.text, /FOR UPDATE/);
  const receipt = sql.queries.find((query) => query.text.includes('INSERT INTO ros_eye_contact_revision_ledger'))!;
  assert.deepEqual(receipt.values.slice(0, 4), [SCOPE.tenantId, SCOPE.purpose, CASE_ID, 1]);
  assert.match(String(receipt.values[4]), /^[a-f0-9]{64}$/);
  assert.equal(receipt.values[5], session().updatedAt);
});

test('session correction verifies the prior aggregate and appends the next independent revision', async () => {
  const before = session();
  const beforeDigest = contactRevisionDigest(SCOPE, [before]);
  const sql = new FakeSql((text) => {
    if (text.includes('SELECT purpose FROM road_events')) return { rows: [{ purpose: SCOPE.purpose }], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_sessions') && text.includes('ORDER BY')) return { rows: [sessionRow(before)], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return { rows: [{ revision: 1, digest: beforeDigest }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const after = session(2, 'LANGUAGE_SELECTION');
  assert.equal(await new PostgresContactRuntimeRepository(sql).transaction((tx) => tx.updateSession(after, 1)), 'UPDATED');

  const receipt = sql.queries.find((query) => query.text.includes('INSERT INTO ros_eye_contact_revision_ledger'))!;
  assert.equal(receipt.values[3], 2);
  assert.equal(receipt.values[4], contactRevisionDigest(SCOPE, [after]));
  assert.notEqual(receipt.values[4], beforeDigest);
});

test('missing or drifted prior contact receipt blocks a session mutation', async () => {
  for (const ledgerRows of [[], [{ revision: 1, digest: 'f'.repeat(64) }]]) {
    const sql = new FakeSql((text) => {
      if (text.includes('SELECT purpose FROM road_events')) return { rows: [{ purpose: SCOPE.purpose }], rowCount: 1 };
      if (text.includes('FROM ros_eye_contact_sessions') && text.includes('ORDER BY')) return { rows: [sessionRow(session())], rowCount: 1 };
      if (text.includes('FROM ros_eye_contact_revision_ledger')) return { rows: ledgerRows, rowCount: ledgerRows.length };
      return { rows: [], rowCount: 1 };
    });
    await assert.rejects(
      () => new PostgresContactRuntimeRepository(sql).transaction((tx) => tx.updateSession(session(2), 1)),
      /contact revision receipt/
    );
    assert.equal(sql.queries.some((query) => query.text.includes('UPDATE ros_eye_contact_sessions SET')), false);
  }
});

test('source returns explicit ABSENT only for an existing exact-scope RoadEvent with no contact state', async () => {
  const sql = new FakeSql((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  assert.deepEqual(await new PostgresContactRevisionSource().load(sql, SCOPE), { status: 'ABSENT' });
  assert.deepEqual(sql.queries[0]?.values, [SCOPE.tenantId, SCOPE.purpose, CASE_ID]);
});

test('source returns PRESENT only when the latest ledger digest matches all authoritative sessions', async () => {
  const current = session(2, 'LANGUAGE_SELECTION');
  const digest = contactRevisionDigest(SCOPE, [current]);
  const sql = new FakeSql((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_sessions')) return { rows: [sessionRow(current)], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return {
      rows: [{ revision: 2, status: 'PRESENT', digest }], rowCount: 1
    };
    return { rows: [], rowCount: 0 };
  });
  assert.deepEqual(await new PostgresContactRevisionSource().load(sql, SCOPE), {
    status: 'PRESENT', binding: { authority: 'SOURCE_LEDGER', revision: 2, digest }
  });
});

test('source fails closed for legacy state without a receipt, drift, and cross-purpose scope', async () => {
  const current = session();
  const missing = new FakeSql((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_sessions')) return { rows: [sessionRow(current)], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  assert.equal(await new PostgresContactRevisionSource().load(missing, SCOPE), null);

  const drift = new FakeSql((text) => {
    if (text.includes('FROM road_events')) return { rows: [{ case_id: CASE_ID }], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_sessions')) return { rows: [sessionRow(current)], rowCount: 1 };
    if (text.includes('FROM ros_eye_contact_revision_ledger')) return {
      rows: [{ revision: 1, status: 'PRESENT', digest: 'f'.repeat(64) }], rowCount: 1
    };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(() => new PostgresContactRevisionSource().load(drift, SCOPE), /does not match/);

  const foreign = new FakeSql(() => ({ rows: [], rowCount: 0 }));
  assert.equal(await new PostgresContactRevisionSource().load(foreign, { ...SCOPE, purpose: 'other-purpose' }), null);
  assert.equal(foreign.queries.length, 1);
});
