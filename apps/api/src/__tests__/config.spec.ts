import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePort } from '../config.js';

test('parsePort accepts valid integer ports', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort(' 8080 '), 8080);
  assert.equal(parsePort('65535'), 65_535);
});

test('parsePort rejects invalid or unsafe ports', () => {
  for (const candidate of ['', '0', '65536', '3.14', 'NaN', '-1', '  ']) {
    assert.throws(() => parsePort(candidate));
  }
});
