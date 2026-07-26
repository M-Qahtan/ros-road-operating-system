import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'artifacts']);
const packages = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const absolute = join(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) walk(absolute);
    else if (entry === 'package.json') packages.push(absolute);
  }
}

walk(root);

const components = new Map();
for (const packageFile of packages) {
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      const key = `${name}@${version}`;
      components.set(key, {
        type: 'library',
        name,
        version,
        purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
        properties: [
          { name: 'ros:dependencyScope', value: group },
          { name: 'ros:declaredBy', value: relative(root, packageFile) },
        ],
      });
    }
  }
}

const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'));
const lockHash = createHash('sha256').update(lockfile).digest('hex');
const output = process.argv[2] ?? 'artifacts/security/sbom.cdx.json';
mkdirSync(dirname(output), { recursive: true });

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'ROS', name: 'generate-sbom.mjs', version: '1.0.0' }],
    component: { type: 'application', name: 'ros-road-operating-system', version: '0.1.0' },
    properties: [
      { name: 'ros:commitSha', value: process.env.GITHUB_SHA ?? 'local' },
      { name: 'ros:pnpmLockSha256', value: lockHash },
      { name: 'ros:scope', value: 'declared workspace dependencies' },
    ],
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
};

writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Wrote ${bom.components.length} components to ${output}`);
