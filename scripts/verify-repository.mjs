import { access, readFile } from 'node:fs/promises';

if (
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.GITHUB_WORKFLOW === 'CI' &&
  process.env.GITHUB_JOB === 'verify' &&
  process.env.GITHUB_HEAD_REF === 'gate-b/negative-merge-block-proof'
) {
  throw new Error('Gate B negative proof: intentionally failing the required verify check.');
}

const required = [
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'apps/api/package.json',
  'apps/api/src/config.ts',
  'apps/api/src/request-security.ts',
  'packages/domain/package.json',
  'packages/domain/src/road-event/road-event.spec.ts',
  'database/migrations/0001_initial.sql',
  'database/migrations/0002_foundation_hardening.sql',
  'docs/02-architecture/system-architecture.md',
  'docs/04-safety/incident-playbooks.md'
];

for (const path of required) {
  await access(path);
}

const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
if (rootPackage.private !== true) {
  throw new Error('The monorepo root must remain private.');
}

for (const path of ['apps/api/package.json', 'packages/domain/package.json']) {
  const packageJson = JSON.parse(await readFile(path, 'utf8'));
  for (const scriptName of ['lint', 'test', 'typecheck']) {
    const script = packageJson.scripts?.[scriptName];
    if (typeof script !== 'string' || script.trim().startsWith('echo ')) {
      throw new Error(`${path} must provide a real ${scriptName} command.`);
    }
  }
}

const compose = await readFile('infrastructure/docker/docker-compose.yml', 'utf8');
if (/image:\s*\S+:latest(?:\s|$)/u.test(compose)) {
  throw new Error('Docker images must not use mutable latest tags.');
}
if (!compose.includes('127.0.0.1:')) {
  throw new Error('Development service ports must bind to loopback.');
}

console.log(`ROS repository verification passed (${required.length} required assets).`);
