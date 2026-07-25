import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTraceId } from '../request-security.js';

test('resolveTraceId accepts a bounded safe identifier', () => {
  assert.equal(resolveTraceId('trace_01HZX-abc.def'), 'trace_01HZX-abc.def');
});

test('resolveTraceId replaces malformed, repeated and oversized identifiers', () => {
  for (const candidate of [
    'trace id',
    'a'.repeat(65),
    ['one', 'two'],
    'line\nbreak',
    ''
  ] as const) {
    const traceId = resolveTraceId(candidate);
    assert.match(traceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
