import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainTf = fs.readFileSync(
  path.join(repoRoot, 'infrastructure', 'evidence-store', 'aws-frankfurt', 'main.tf'),
  'utf8'
);

const expected = 'oidc_subject               = "repo:${var.repository_owner}@${var.repository_owner_id}/${var.repository_name}@${var.repository_id}:ref:${local.trusted_ref}"';
const legacy = 'oidc_subject               = "repo:${local.repository_full_name}:ref:${local.trusted_ref}"';

assert.ok(mainTf.includes(expected), 'Frankfurt OIDC subject must bind owner ID and repository ID');
assert.ok(!mainTf.includes(legacy), 'legacy name-only OIDC subject must not be trusted');
assert.ok(mainTf.includes('variable = "token.actions.githubusercontent.com:sub"'), 'OIDC trust must enforce sub');
assert.ok(mainTf.includes('variable = "token.actions.githubusercontent.com:repository_id"'), 'OIDC trust must enforce repository_id');
assert.ok(mainTf.includes('variable = "token.actions.githubusercontent.com:repository_owner_id"'), 'OIDC trust must enforce repository_owner_id');
assert.ok(mainTf.includes('variable = "token.actions.githubusercontent.com:ref"'), 'OIDC trust must enforce ref');
assert.ok(mainTf.includes('variable = "token.actions.githubusercontent.com:workflow"'), 'OIDC trust must enforce workflow');
assert.ok(mainTf.includes('values   = ["sts.amazonaws.com"]'), 'OIDC trust must enforce sts.amazonaws.com audience');

console.log('Frankfurt immutable OIDC subject trust PASS');
