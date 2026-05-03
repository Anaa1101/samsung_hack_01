import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { db } from "./db.js";

export type TwinPatterns = {
  raw: string;
  acceptance_rate: Record<string, number>;
  notif_24h: number;
};

function parseAcceptanceRate(raw: string): Record<string, number> {
  // Matches "<skill>:" then later "acceptance_rate: 0.79"
  const out: Record<string, number> = {};
  const blocks = raw.split(/\n(?=\S)/);
  for (const block of blocks) {
    const head = block.split("\n")[0].trim();
    if (!head.endsWith(":")) continue;
    const skill = head.slice(0, -1);
    const m = block.match(/acceptance_rate:\s*([0-9.]+)/);
    if (m) out[skill] = Number(m[1]);
  }
  return out;
}

export function loadTwin(): TwinPatterns {
  const raw = readFileSync(config.paths.twin, "utf8");
  const acceptance_rate = parseAcceptanceRate(raw);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE ts >= ?")
    .get(since) as { c: number } | undefined;
  const notif_24h = row?.c ?? 0;
  return { raw, acceptance_rate, notif_24h };
}
