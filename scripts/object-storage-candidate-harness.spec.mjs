import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { evaluate } from "./object-storage-candidate-harness.mjs";

const CASE_IDS = Array.from({ length: 13 }, (_, i) =>
  `OS-C${String(i + 1).padStart(2, "0")}`,
);

function validRecord() {
  return {
    rosCommitSha: "a".repeat(40),
    harnessRevision: "v1",
    candidate: {
      name: "candidate",
      version: "1.0.0",
      digest: `sha256:${"b".repeat(64)}`,
    },
    executedAt: "2026-10-01T15:00:00Z",
    environmentId: "isolated-sandbox",
    operationalBoundariesUntouched: true,
    cases: CASE_IDS.map((id) => ({
      id,
      outcome: "PASS",
      evidence: `evidence/${id}.json`,
    })),
  };
}

test("13/13 evidenced PASS cases produce PASS", () => {
  assert.deepEqual(evaluate(validRecord()), {
    disposition: "PASS",
    hardReject: false,
    rejected: [],
    notProven: [],
  });
});

test("missing evidence invalidates the run instead of weakening the gate", () => {
  const record = validRecord();
  record.cases[0].evidence = "   ";
  const result = evaluate(record);

  assert.equal(result.disposition, "INVALID_RUN");
  assert.match(result.reasons[0], /missing evidence for OS-C01/);
});

test("NOT_PROVEN can never become PASS", () => {
  const record = validRecord();
  record.cases[4].outcome = "NOT_PROVEN";
  const result = evaluate(record);

  assert.equal(result.disposition, "NOT_PROVEN");
  assert.equal(result.hardReject, false);
  assert.deepEqual(result.notProven, ["OS-C05"]);
});

for (const id of ["OS-C07", "OS-C13"]) {
  test(`${id} rejection raises the hard-reject indicator`, () => {
    const record = validRecord();
    record.cases.find((item) => item.id === id).outcome = "REJECT";
    const result = evaluate(record);

    assert.equal(result.disposition, "REJECT");
    assert.equal(result.hardReject, true);
    assert.deepEqual(result.rejected, [id]);
  });
}

test("ordinary rejection rejects without falsely claiming hard-reject", () => {
  const record = validRecord();
  record.cases[1].outcome = "REJECT";
  const result = evaluate(record);

  assert.equal(result.disposition, "REJECT");
  assert.equal(result.hardReject, false);
  assert.deepEqual(result.rejected, ["OS-C02"]);
});

test("missing case invalidates the run", () => {
  const record = validRecord();
  record.cases = record.cases.filter((item) => item.id !== "OS-C13");
  const result = evaluate(record);

  assert.equal(result.disposition, "INVALID_RUN");
  assert.match(result.reasons[0], /missing case OS-C13/);
});

test("operational boundary acknowledgement is mandatory", () => {
  const record = validRecord();
  record.operationalBoundariesUntouched = false;
  const result = evaluate(record);

  assert.equal(result.disposition, "INVALID_RUN");
  assert.match(result.reasons[0], /operationalBoundariesUntouched must be true/);
});

test("candidate digest must be immutable sha256", () => {
  const record = validRecord();
  record.candidate.digest = "candidate:latest";
  const result = evaluate(record);

  assert.equal(result.disposition, "INVALID_RUN");
  assert.match(result.reasons[0], /candidate.digest must be immutable sha256/);
});


const CLI_PATH = fileURLToPath(new URL("./object-storage-candidate-harness.mjs", import.meta.url));

function runCli(record, invocationPath = CLI_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ros-object-storage-harness-"));
  const evidencePath = path.join(dir, "evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(record), "utf8");
  try {
    return spawnSync(process.execPath, [invocationPath, evidencePath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI executes through a relative script path and PASS exits zero", () => {
  const relativeCliPath = path.relative(process.cwd(), CLI_PATH);
  const result = runCli(validRecord(), relativeCliPath);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).disposition, "PASS");
});

test("CLI executes through an absolute script path and PASS exits zero", () => {
  const result = runCli(validRecord());

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).disposition, "PASS");
});

for (const [expectedDisposition, mutate] of [
  ["REJECT", (record) => { record.cases[1].outcome = "REJECT"; }],
  ["NOT_PROVEN", (record) => { record.cases[4].outcome = "NOT_PROVEN"; }],
  ["INVALID_RUN", (record) => { record.operationalBoundariesUntouched = false; }],
]) {
  test(`CLI fails closed for ${expectedDisposition}`, () => {
    const record = validRecord();
    mutate(record);
    const result = runCli(record);

    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).disposition, expectedDisposition);
  });
}
