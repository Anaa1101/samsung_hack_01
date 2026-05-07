const BASE = process.env.AURA_URL ?? "http://localhost:3000";

async function jget(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

async function jpost(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

async function run() {
  console.log(`[edge] base=${BASE}`);

  console.log("\n[edge] reset telemetry");
  await jpost("/api/simulate/reset");

  console.log("\n[edge] empty calendar + no steps + no HRV");
  await jpost("/api/settings", { hrv_stress: "NaN" });
  const scoreEmpty = await jget("/api/score");
  console.log(`[edge] score total=${scoreEmpty.total}`);

  console.log("\n[edge] status endpoint sanity");
  const status = await jget("/api/status");
  console.log(`[edge] status ok, next_event=${status.next_event ? "yes" : "no"}`);

  console.log("\n[edge] all-dismissed history (3 samples)");
  for (let i = 0; i < 3; i++) {
    await jpost("/api/run/morning_brief", { dry_run: false, lang: "en" });
    const runs = await jget("/api/skill_runs");
    const latest = runs.find((r) => r.skill === "morning_brief" && r.accepted === null && r.dismissed === null);
    if (latest) await jpost(`/api/skill_runs/${latest.id}/feedback`, { action: "dismiss" });
  }

  const gate = await jpost("/api/gate/test", { skill: "morning_brief" });
  console.log(`[edge] gate decision intervene=${gate.decision.intervene} reason="${gate.decision.reason}"`);

  console.log("\n[edge] done");
}

run().catch((err) => {
  console.error("[edge] failed:", err.message);
  console.error("[edge] Ensure the server is running: npm run dev");
  process.exit(1);
});
