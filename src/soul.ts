import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { config } from "./config.js";

export type CostWeights = { false_alarm: number; missed_help: number };

export type SoulContext =
  | "default"
  | "quiet_hours"
  | "focus_block"
  | "pre_meeting"
  | "commute";

export type Soul = {
  raw: string;
  cost_weights: Record<SoulContext, CostWeights>;
  quiet_hours: { start: string; end: string };
  enabled_skills: string[];
};

function extractYamlBlock(raw: string, key: string): unknown {
  const lines = raw.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.trim().startsWith(`${key}:`));
  if (headerIdx === -1) return null;
  const block: string[] = [lines[headerIdx]];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.length === 0) continue;
    if (/^\s/.test(l)) {
      block.push(l);
      continue;
    }
    break;
  }
  return parseYaml(block.join("\n"));
}

export function loadSoul(): Soul {
  const raw = readFileSync(config.paths.soul, "utf8");
  const cwBlock = extractYamlBlock(raw, "cost_weights") as
    | { cost_weights: Record<SoulContext, CostWeights> }
    | null;
  const cost_weights = cwBlock?.cost_weights ?? {
    default: { false_alarm: 1, missed_help: 1 },
    quiet_hours: { false_alarm: 9, missed_help: 1 },
    focus_block: { false_alarm: 6, missed_help: 1 },
    pre_meeting: { false_alarm: 1, missed_help: 4 },
    commute: { false_alarm: 1.5, missed_help: 3 },
  };
  return {
    raw,
    cost_weights,
    quiet_hours: { start: "22:00", end: "06:30" },
    enabled_skills: ["morning_brief"],
  };
}
