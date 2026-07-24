import { access, readFile } from 'node:fs/promises';

const required = [
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'apps/api/package.json',
  'packages/domain/package.json',
  'database/migrations/0001_initial.sql',
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

console.log(`ROS repository verification passed (${required.length} required assets).`);
