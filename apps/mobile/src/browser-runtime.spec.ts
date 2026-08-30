import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulatedFieldCompanionGateway } from './field-companion.js';
import { clearLegacyUnscopedMobileStorage, createBrowserGateway, MOBILE_DEVICE_REGISTRATION_STORAGE_KEY, MOBILE_RESOURCE_IDS_STORAGE_KEY, resolveDeviceRegistrationOperation, resolveMobileResourceIdentifiers, resolveMobileStorageSubjectId, scopedMobileStorageKey } from './browser-runtime.js';
import { HttpFieldCompanionGateway, MobileMvpAuthenticationError } from './mvp-http-gateway.js';

test('browser defaults to authenticated HTTP and never silently selects simulation', () => {
  const selection = createBrowserGateway({ accessToken: () => 'signed.oidc.jwt' });
  assert.equal(selection.mode, 'MVP');
  assert.ok(selection.gateway instanceof HttpFieldCompanionGateway);
  assert.equal(selection.gateway.simulation, false);
});

test('browser fails closed when MVP authentication is absent', () => {
  assert.throws(() => createBrowserGateway({ accessToken: () => null }), MobileMvpAuthenticationError);
  assert.throws(() => createBrowserGateway({ configuredMode: 'mvp', accessToken: () => '   ' }), MobileMvpAuthenticationError);
});

test('simulation gateway requires exact explicit development opt-in', () => {
  const selected = createBrowserGateway({ configuredMode: 'simulation', accessToken: () => null });
  assert.equal(selected.mode, 'SIMULATION');
  assert.ok(selected.gateway instanceof SimulatedFieldCompanionGateway);
  assert.equal(selected.gateway.simulation, true);

  assert.throws(() => createBrowserGateway({ configuredMode: 'sim', accessToken: () => null }), MobileMvpAuthenticationError);
});

test('authenticated host resource UUIDs win and persistence contains identifiers only', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const deviceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const storageSubjectId = '99999999-9999-4999-8999-999999999999';
  const storageKey = scopedMobileStorageKey(MOBILE_RESOURCE_IDS_STORAGE_KEY, storageSubjectId);
  const resolved = resolveMobileResourceIdentifiers({ storage, storageSubjectId, hostCaseId: caseId, hostSessionId: sessionId, hostDeviceId: deviceId });
  assert.deepEqual(resolved, { caseId, sessionId, deviceId });
  assert.deepEqual(JSON.parse(values.get(storageKey) ?? ''), { caseId, sessionId, deviceId });
  assert.doesNotMatch(values.get(storageKey) ?? '', /token|tenant|purpose|role/i);
});

test('local UUID resource identifiers are generated once and reused without granting authority', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const generated = ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'];
  const storageSubjectId = '99999999-9999-4999-8999-999999999999';
  let index = 0;
  const first = resolveMobileResourceIdentifiers({ storage, storageSubjectId, createUuid: () => generated[index++]! });
  const second = resolveMobileResourceIdentifiers({ storage, storageSubjectId, createUuid: () => { throw new Error('must reuse persisted identifiers'); } });
  assert.deepEqual(first, second);
  assert.throws(() => resolveMobileResourceIdentifiers({ storage, storageSubjectId, hostCaseId: 'case-not-uuid' }), TypeError);
});

test('shared browser storage is isolated by the authenticated OIDC subject', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const subjectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const subjectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const idsA = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const idsB = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
  let indexA = 0;
  let indexB = 0;

  const firstA = resolveMobileResourceIdentifiers({ storage, storageSubjectId: subjectA, createUuid: () => idsA[indexA++]! });
  const firstB = resolveMobileResourceIdentifiers({ storage, storageSubjectId: subjectB, createUuid: () => idsB[indexB++]! });
  const replayA = resolveMobileResourceIdentifiers({ storage, storageSubjectId: subjectA, createUuid: () => { throw new Error('subject A must reuse its own identifiers'); } });

  assert.deepEqual(firstA, replayA);
  assert.notDeepEqual(firstA, firstB);
  assert.notEqual(scopedMobileStorageKey(MOBILE_RESOURCE_IDS_STORAGE_KEY, subjectA), scopedMobileStorageKey(MOBILE_RESOURCE_IDS_STORAGE_KEY, subjectB));
  assert.equal(values.has(MOBILE_RESOURCE_IDS_STORAGE_KEY), false);
});

test('MVP storage requires a UUID OIDC subject while simulation stays isolated', () => {
  assert.equal(resolveMobileStorageSubjectId('MVP', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.throws(() => resolveMobileStorageSubjectId('MVP'), MobileMvpAuthenticationError);
  assert.throws(() => resolveMobileStorageSubjectId('MVP', 'self-attested-user'), MobileMvpAuthenticationError);
  assert.match(resolveMobileStorageSubjectId('SIMULATION'), /^[0-9a-f-]{36}$/);
});

test('upgrade removes only legacy unscoped mobile keys', () => {
  const values = new Map<string, string>([
    [MOBILE_RESOURCE_IDS_STORAGE_KEY, 'legacy-resource-state'],
    [MOBILE_DEVICE_REGISTRATION_STORAGE_KEY, 'legacy-registration-state'],
    ['ros-eye-field-companion-mvp', 'legacy-contact-state'],
    ['unrelated.application.key', 'preserve-me']
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };

  clearLegacyUnscopedMobileStorage(storage, 'ros-eye-field-companion-mvp');

  assert.deepEqual([...values.entries()], [['unrelated.application.key', 'preserve-me']]);
  assert.throws(() => clearLegacyUnscopedMobileStorage(storage, '../unsafe-key'), TypeError);
});

test('device registration operation id is stable only for the exact consent and app version fingerprint', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const generated = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  let index = 0;
  const storageSubjectId = '99999999-9999-4999-8999-999999999999';
  const storageKey = scopedMobileStorageKey(MOBILE_DEVICE_REGISTRATION_STORAGE_KEY, storageSubjectId);
  const base = { storage, storageSubjectId, deviceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', appVersion: '0.1.0', consentOccurredAt: '2026-08-21T08:00:00.000Z' };
  const first = resolveDeviceRegistrationOperation({ ...base, createUuid: () => generated[index++]! });
  const replay = resolveDeviceRegistrationOperation({ ...base, createUuid: () => { throw new Error('must reuse exact fingerprint'); } });
  const renewed = resolveDeviceRegistrationOperation({ ...base, appVersion: '0.1.1', createUuid: () => generated[index++]! });
  assert.equal(first.operationId, generated[0]);
  assert.deepEqual(replay, first);
  assert.equal(renewed.operationId, generated[1]);
  assert.notEqual(renewed.fingerprint, first.fingerprint);
  assert.doesNotMatch(values.get(storageKey) ?? '', /token|tenant|actor|role/i);
});
