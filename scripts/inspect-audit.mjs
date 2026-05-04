// scripts/inspect-audit.mjs
// Read-only inspector for the AURA audit log.
// Shows the 5 most recent gate_decision entries with calibration fields.
//
// Usage: npm run inspect:audit

import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/aura.db");

const rows = db
  .prepare(
    "SELECT id, ts, kind, payload FROM audit_log WHERE kind = 'gate_decision' ORDER BY id DESC LIMIT 5",
  )
  .all();

if (rows.length === 0) {
  console.log("No gate_decision entries found.");
  process.exit(0);
}

const line = "─".repeat(64);

for (const row of rows) {
  const p = JSON.parse(row.payload);
  const skill = p.skill ?? "(unknown)";

  console.log(`\n${line}`);
  console.log(`id: ${row.id}   ts: ${row.ts}   skill: ${skill}`);
  console.log(`${line}`);

  // Top-level keys present in the payload.
  console.log("Top-level keys:", Object.keys(p).join(", "));

  // Flat calibration fields — present when the entry was written by _lib.ts:runSkill.
  const hasFlat = p.calibration_status !== undefined;
  if (hasFlat) {
    console.log("\n[flat calibration fields]");
    console.log(`  p_need              : ${p.p_need}`);
    console.log(`  p_accept            : ${p.p_accept}`);
    console.log(`  c_fa                : ${p.c_fa}`);
    console.log(`  c_fn                : ${p.c_fn}`);
    console.log(`  threshold (tau)     : ${p.threshold}`);
    console.log(`  calibration_status  : ${p.calibration_status}`);
    console.log(`  n_samples           : ${p.n_samples}`);
  } else {
    console.log("\n[flat calibration fields]: not present (skill uses own auditAppend)");
  }

  // Nested decision object — always present.
  if (p.decision) {
    const d = p.decision;
    console.log("\n[decision (nested)]");
    console.log(`  intervene           : ${d.intervene}`);
    console.log(`  mode                : ${d.mode}`);
    console.log(`  context_label       : ${d.context_label}`);
    console.log(`  c_fa                : ${typeof d.c_fa === "number" ? d.c_fa.toFixed(4) : d.c_fa}`);
    console.log(`  c_fn                : ${typeof d.c_fn === "number" ? d.c_fn.toFixed(4) : d.c_fn}`);
    console.log(`  tau                 : ${typeof d.tau === "number" ? d.tau.toFixed(4) : d.tau}`);
    console.log(`  utility             : ${typeof d.utility === "number" ? d.utility.toFixed(4) : d.utility}`);
    console.log(`  calibration_status  : ${d.calibration_status ?? "(not set)"}`);
    console.log(`  n_samples           : ${d.n_samples ?? "(not set)"}`);
    console.log(`  reason              : ${d.reason}`);
  }
}

console.log(`\n${line}`);
