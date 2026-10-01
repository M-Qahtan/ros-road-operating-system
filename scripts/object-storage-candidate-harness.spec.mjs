import test from "node:test";
import assert from "node:assert/strict";

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
