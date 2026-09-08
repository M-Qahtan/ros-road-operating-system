import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runner = readFileSync('scripts/run-postgres-integration.sh', 'utf8');
const localHarness = readFileSync('scripts/run-local-postgres-brain-journey.sh', 'utf8');
const setup = readFileSync('database/tests/0010_ros_brain_journey_setup.sql', 'utf8');
const reconnect = readFileSync('database/tests/0011_ros_brain_journey_reconnect.sql', 'utf8');

test('PostgreSQL integration runner fails explicitly before claiming an unexecuted test', () => {
  assert.match(runner, /command -v "\$required_command"/);
  assert.match(runner, /no integration test was executed/);
  assert.match(runner, /for migration in database\/migrations\/\*\.sql/);
  assert.match(runner, /for test_file in database\/tests\/\*\.sql/);
  assert.ok(runner.indexOf('Running ${test_file}') < runner.indexOf('integration checks passed'));
  assert.match(localHarness, /postgis\/postgis:16-3\.4/);
  assert.match(localHarness, /trap cleanup EXIT/);
  assert.match(localHarness, /--publish "127\.0\.0\.1:/);
  assert.match(localHarness, /bash scripts\/run-postgres-integration\.sh/);
});

test('ordered SQL journey covers current read, source invalidation, rollback and a new client connection', () => {
  assert.match(setup, /ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(setup, /FOR (?:SHARE|UPDATE)/);
  assert.match(setup, /indicator correction did not invalidate the prior binding/);
  assert.match(setup, /ROLLBACK/);
  assert.match(setup, /rolled-back indicator revision remained visible/);
  assert.match(setup, /human_review_status = 'PENDING'/);
  assert.match(setup, /activation_authorized = false/);
  assert.match(reconnect, /durable across client reconnect/);
  assert.ok('0010_ros_brain_journey_setup.sql' < '0011_ros_brain_journey_reconnect.sql');
});
