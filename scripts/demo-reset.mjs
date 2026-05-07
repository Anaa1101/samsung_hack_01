// Demo reset — clears recent notification noise so the adversary stops vetoing.
// Run BEFORE recording: `node scripts/demo-reset.mjs`
// The daemon must be stopped first (the DB is single-writer with WAL).

import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const dbPath = resolve(process.cwd(), "data", "aura.db");
const db = new DatabaseSync(dbPath);

const stats = {
  skill_runs: db.prepare("DELETE FROM skill_runs WHERE ts > datetime('now', '-6 hours')").run().changes,
  notifications: db.prepare("DELETE FROM notifications WHERE ts > datetime('now', '-6 hours')").run().changes,
  quiet_blocks_active: db.prepare("DELETE FROM quiet_blocks WHERE end_ts > datetime('now')").run().changes,
};

console.log("[demo-reset] cleared recent state:");
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)}: ${v} rows deleted`);

// Always wipe lingering demo events and seed a FRESH "Investor pitch" event
// 3 minutes out. Without an upcoming event, p_need stays low (default context,
// tau=0.5), so the gate rejects "brief me" with utility ~0.20 < 0.45 — voice
// commands appear silent even though the system is fine.
const wiped = db.prepare("DELETE FROM calendar WHERE title LIKE '%Investor%' OR title LIKE '%Demo%' OR start_ts < datetime('now')").run().changes;
const start = new Date(Date.now() + 3 * 60 * 1000).toISOString();
const end = new Date(Date.now() + 33 * 60 * 1000).toISOString();
db.prepare("INSERT INTO calendar (start_ts, end_ts, title, location) VALUES (?, ?, ?, ?)")
  .run(start, end, "Investor pitch", "Demo");
console.log(`  calendar      : wiped ${wiped} stale row(s), seeded "Investor pitch" 3 min from now`);

db.close();
console.log("\n[demo-reset] done. Now: npm run start");
