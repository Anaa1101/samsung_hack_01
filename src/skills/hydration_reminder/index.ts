// hydration_reminder — context-aware water break nudge.
//
// Logic:
//   1. Read HRV stress from sensor fusion (via db settings).
//   2. Check if user is sedentary (low steps → dry work session).
//   3. Check time of day — mid-afternoon (13:00–16:00) is peak dehydration risk.
//   4. Combine signals into a "hydration_urgency" score (0–1).
//   5. If urgency < 0.3: skip silently (user probably just had a break).
//   6. If urgency ≥ 0.6: escalate to "high" with a specific reason.
//
// The message adapts to the actual conditions so it never feels generic.

import { runSkill, type SkillBaseResult } from "../_lib.js";
import { db, localDateString } from "../../db.js";
import { readHrvStress } from "../../pi-engine/fusion.js";
import type { Lang } from "../../i18n.js";

// ── Data helpers ──────────────────────────────────────────────────────────────

function recentSteps(now: Date, hours = 2): number {
  const date = localDateString(now);
  const startHour = Math.max(0, now.getHours() - hours);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ? AND hour >= ? AND hour <= ?",
    )
    .get(date, startHour, now.getHours()) as { c: number } | undefined;
  return row?.c ?? 0;
}

// 0–1 risk score: combines time-of-day, HRV stress, and sedentary state.
function hydrationUrgency(now: Date): {
  score: number;
  reasons: string[];
} {
  const hour = now.getHours();
  const reasons: string[] = [];
  let score = 0;

  // Time-of-day: mid-afternoon peak risk.
  if (hour >= 13 && hour <= 16) {
    score += 0.3;
    reasons.push("mid-afternoon");
  } else if (hour >= 10 && hour <= 12) {
    score += 0.15;
  }

  // HRV stress: high stress correlates with dehydration.
  const hrv = readHrvStress();
  if (Number.isFinite(hrv) && hrv > 0.6) {
    score += 0.35;
    reasons.push("elevated stress");
  } else if (Number.isFinite(hrv) && hrv > 0.4) {
    score += 0.15;
  }

  // Sedentary desk work: low steps in hot/dry office environments.
  const steps = recentSteps(now);
  if (steps < 300) {
    score += 0.25;
    reasons.push("sedentary session");
  }

  // Recent hydration skill_run: if we pinged < 90 min ago, back off.
  const ninetyMinAgo = new Date(now.getTime() - 90 * 60000).toISOString();
  const recent = db
    .prepare(
      "SELECT COUNT(*) AS c FROM skill_runs WHERE skill = 'hydration_reminder' AND ts >= ?",
    )
    .get(ninetyMinAgo) as { c: number } | undefined;
  if ((recent?.c ?? 0) > 0) {
    score *= 0.2; // Heavy suppression — we already nudged recently.
  }

  return { score: Math.min(1, score), reasons };
}

// ── Text builders ─────────────────────────────────────────────────────────────

function buildText(lang: Lang, reasons: string[], urgent: boolean): string {
  const context = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";

  if (lang === "hi") {
    return urgent
      ? `स्ट्रेस और काम की वजह से${context} — अभी एक गिलास पानी पिएँ।`
      : `पानी पीने का सही समय है${context}। एक गिलास पी लीजिए।`;
  }
  if (lang === "kn") {
    return urgent
      ? `ಒತ್ತಡ ಮತ್ತು ಕೆಲಸ${context} — ಈಗ ಒಂದು ಲೋಟ ನೀರು ಕುಡಿಯಿರಿ.`
      : `ನೀರು ಕುಡಿಯಲು ಸೂಕ್ತ ಸಮಯ${context}. ಒಂದು ಲೋಟ ತೆಗೆದುಕೊಳ್ಳಿ.`;
  }
  return urgent
    ? `Heads up: ${context.trim() || "it's been a while"} — time to hydrate. Drink a glass of water now.`
    : `Water break${context}. A glass of water keeps focus sharp.`;
}

// ── Skill entry point ─────────────────────────────────────────────────────────

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang; prewarm?: boolean } = {},
): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  const { score, reasons } = hydrationUrgency(now);

  // Low urgency: skip silently — no point nagging for hydration constantly.
  if (score < 0.3) {
    return runSkill(
      {
        skill: "hydration_reminder",
        importance: "low",
        buildText: ({ lang }) => buildText(lang, reasons, false),
      },
      { ...opts, dry_run: true },
    );
  }

  const urgent = score >= 0.6;
  const importance = urgent ? "high" : "normal";

  return runSkill(
    {
      skill: "hydration_reminder",
      importance,
      buildText: ({ lang }) => buildText(lang, reasons, urgent),
      systemPrompt:
        "You are AURA, a proactive wellness companion. The user needs a water reminder. " +
        "Write a short, friendly nudge (1-2 sentences). " +
        "Mention the specific reason for the reminder if given. Keep it light and warm.",
    },
    opts,
  );
}
