// standup_break — nudges when the user has been sedentary for too long.
//
// Logic:
//   1. Read actual step counts from the last 2 hours in the DB.
//   2. If > 500 steps: user is active → skip silently.
//   3. If 200–500 steps: mildly sedentary → normal importance.
//   4. If < 200 steps: very sedentary → escalate to "high" importance.
//
// The message includes the real step count so the user can see AURA is
// reading live data, not just firing on a dumb timer.

import { runSkill, type SkillBaseResult } from "../_lib.js";
import { db, localDateString } from "../../db.js";
import type { Lang } from "../../i18n.js";

// ── Data access ───────────────────────────────────────────────────────────────

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

// How many consecutive hours has the user had < 100 steps/hr?
function sedentaryHours(now: Date): number {
  const date = localDateString(now);
  const currentHour = now.getHours();
  let streak = 0;
  for (let h = currentHour; h >= Math.max(0, currentHour - 5); h--) {
    const row = db
      .prepare("SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ? AND hour = ?")
      .get(date, h) as { c: number } | undefined;
    if ((row?.c ?? 0) < 100) streak++;
    else break;
  }
  return streak;
}

// ── Text builders ─────────────────────────────────────────────────────────────

function buildText(lang: Lang, steps: number, sedHours: number): string {
  const stepsStr = steps.toLocaleString();
  const hoursStr = sedHours >= 2 ? `${sedHours} hours` : "a while";

  if (lang === "hi") {
    return sedHours >= 3
      ? `${hoursStr} से बैठे हैं और केवल ${stepsStr} कदम चले। उठिए, टहलिए — अभी।`
      : `काफ़ी देर से बैठे हैं (${stepsStr} कदम)। 60 सेकंड के लिए खड़े होकर स्ट्रेच करें।`;
  }
  if (lang === "kn") {
    return sedHours >= 3
      ? `${hoursStr} ಕುಳಿತಿದ್ದೀರಿ, ಕೇವಲ ${stepsStr} ಹೆಜ್ಜೆಗಳು. ಎದ್ದು ನಡೆಯಿರಿ — ಈಗಲೇ.`
      : `ತುಂಬಾ ಹೊತ್ತಿನಿಂದ ಕುಳಿತಿದ್ದೀರಿ (${stepsStr} ಹೆಜ್ಜೆ). 60 ಸೆಕೆಂಡು ಸ್ಟ್ರೆಚ್ ಮಾಡಿ.`;
  }
  return sedHours >= 3
    ? `You've been sedentary for ${hoursStr} (only ${stepsStr} steps). Time to move — even a 2-min walk helps.`
    : `You've been still for a while (${stepsStr} steps in 2h). Stand up and stretch for 60 seconds.`;
}

// ── Skill entry point ─────────────────────────────────────────────────────────

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang; prewarm?: boolean } = {},
): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  const steps = recentSteps(now);
  const sedHours = sedentaryHours(now);

  // Active user: > 500 steps in 2h → nothing to do.
  if (steps > 500) {
    return runSkill(
      {
        skill: "standup_break",
        importance: "low",
        buildText: ({ lang }) => buildText(lang, steps, sedHours),
      },
      { ...opts, dry_run: true }, // silent no-op
    );
  }

  // Very sedentary (< 200 steps OR 3+ sedentary hours): escalate urgency.
  const importance = steps < 200 || sedHours >= 3 ? "high" : "normal";

  return runSkill(
    {
      skill: "standup_break",
      importance,
      buildText: ({ lang }) => buildText(lang, steps, sedHours),
      systemPrompt:
        "You are AURA, a caring health companion. The user has been sedentary. " +
        "Write a brief, warm nudge (1-2 sentences) to stand up and move. " +
        "Mention the concrete step count from the context. Do not lecture.",
    },
    opts,
  );
}
