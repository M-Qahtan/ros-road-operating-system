#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CASE_IDS = Array.from({ length: 13 }, (_, i) => `OS-C${String(i + 1).padStart(2, "0")}`);
const ALLOWED = new Set(["PASS", "REJECT", "NOT_PROVEN"]);
const HARD_REJECT = new Set(["OS-C07", "OS-C13"]);
const SHA40 = /^[0-9a-f]{40}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/i;

function invalid(reason) {
  return { disposition: "INVALID_RUN", hardReject: false, reasons: [reason] };
}

export function evaluate(record) {
  if (!record || typeof record !== "object") return invalid("record must be an object");
  if (!SHA40.test(record.rosCommitSha ?? "")) return invalid("rosCommitSha must be a full 40-hex SHA");
  if (!String(record.harnessRevision ?? "").trim()) return invalid("harnessRevision is required");
  if (!String(record.candidate?.name ?? "").trim()) return invalid("candidate.name is required");
  if (!String(record.candidate?.version ?? "").trim()) return invalid("candidate.version is required");
  if (!DIGEST.test(record.candidate?.digest ?? "")) return invalid("candidate.digest must be immutable sha256");
  if (!String(record.executedAt ?? "").trim() || Number.isNaN(Date.parse(record.executedAt))) return invalid("executedAt must be an ISO-compatible timestamp");
  if (!String(record.environmentId ?? "").trim()) return invalid("environmentId is required");
  if (record.operationalBoundariesUntouched !== true) return invalid("operationalBoundariesUntouched must be true");
  if (!Array.isArray(record.cases)) return invalid("cases must be an array");

  const byId = new Map();
  for (const item of record.cases) {
    if (!item || !CASE_IDS.includes(item.id)) return invalid("unknown or malformed case id");
    if (byId.has(item.id)) return invalid(`duplicate case ${item.id}`);
    if (!ALLOWED.has(item.outcome)) return invalid(`invalid outcome for ${item.id}`);
    if (!String(item.evidence ?? "").trim()) return invalid(`missing evidence for ${item.id}`);
    byId.set(item.id, item);
  }
  for (const id of CASE_IDS) if (!byId.has(id)) return invalid(`missing case ${id}`);

  const rejected = CASE_IDS.filter(id => byId.get(id).outcome === "REJECT");
  const notProven = CASE_IDS.filter(id => byId.get(id).outcome === "NOT_PROVEN");
  const hard = rejected.filter(id => HARD_REJECT.has(id));

  if (rejected.length) return { disposition: "REJECT", hardReject: hard.length > 0, rejected, notProven };
  if (notProven.length) return { disposition: "NOT_PROVEN", hardReject: false, rejected: [], notProven };
  return { disposition: "PASS", hardReject: false, rejected: [], notProven: [] };
}

function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath) {
    process.stderr.write("usage: node scripts/object-storage-candidate-harness.mjs <evidence.json>\n");
    process.exit(2);
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  } catch (error) {
    process.stderr.write(JSON.stringify(invalid(`cannot read/parse evidence: ${error.message}`), null, 2) + "\n");
    process.exit(2);
  }
  const result = evaluate(record);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.disposition === "PASS" ? 0 : 1);
}

const invokedAs = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedAs === import.meta.url) main();
