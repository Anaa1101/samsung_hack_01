import { runSkill, type SkillBaseResult } from "../_lib.js";
import { db } from "../../db.js";
import type { Lang } from "../../i18n.js";

// Sedentary check: if the last 2 hours have <300 steps, user is desk-bound.
function recentSteps(now: Date, hours = 2): number {
  const date = now.toISOString().slice(0, 10);
  const startHour = Math.max(0, now.getHours() - hours);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ? AND hour >= ? AND hour <= ?",
    )
    .get(date, startHour, now.getHours()) as { c: number } | undefined;
  return row?.c ?? 0;
}

const TEXT: Record<Lang, string> = {
  en: "You've been still for a while. Stand up, stretch for 60 seconds.",
  hi: "काफ़ी देर से बैठे हैं। उठिए, 60 सेकंड स्ट्रेच कीजिए।",
  kn: "ತುಂಬಾ ಹೊತ್ತಿನಿಂದ ಕುಳಿತಿದ್ದೀರಿ. ಎದ್ದು 60 ಸೆಕೆಂಡು ಸ್ಟ್ರೆಚ್ ಮಾಡಿ.",
};

export async function run(opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {}): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  if (recentSteps(now) > 300) {
    // Not sedentary — short-circuit silently.
    return runSkill(
      {
        skill: "standup_break",
        importance: "low",
        buildText: ({ lang }) => TEXT[lang] ?? TEXT.en,
      },
      { ...opts, dry_run: true }, // force dry — nothing to nudge
    );
  }
  return runSkill(
    {
      skill: "standup_break",
      importance: "normal",
      buildText: ({ lang }) => TEXT[lang] ?? TEXT.en,
    },
    opts,
  );
}
