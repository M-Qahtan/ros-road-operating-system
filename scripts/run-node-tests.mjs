import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function findSpecs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findSpecs(path));
    else if (entry.isFile() && entry.name.endsWith('.spec.js')) files.push(path);
  }
  return files;
}

const roots = process.argv.slice(2);
if (roots.length === 0) throw new Error('At least one compiled test directory is required.');

const specs = (await Promise.all(roots.map((root) => findSpecs(resolve(root)))))
  .flat()
  .sort((left, right) => left.localeCompare(right, 'en'));

if (specs.length === 0) throw new Error(`No compiled *.spec.js files found under: ${roots.join(', ')}`);

const child = spawn(process.execPath, ['--test', ...specs], {
  cwd: process.cwd(), env: process.env, shell: false, stdio: 'inherit'
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal !== null) reject(new Error(`Node test runner terminated by ${signal}`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
