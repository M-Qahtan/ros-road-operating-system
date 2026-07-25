import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runRiyadhPilotSimulation } from './riyadh-pilot.js';

const result = await runRiyadhPilotSimulation();
const outputPath = resolve(process.env.ROS_PILOT_REPORT ?? 'artifacts/riyadh-pilot/result.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  scenario: 'riyadh-incident-vertical-slice-v1',
  status: 'passed',
  result
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ level: 'info', message: 'Riyadh pilot simulation passed', outputPath, result }));
