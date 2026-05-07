// wind_down — bedtime preparation nudge, calibrated to tomorrow's demands.
//
// Logic:
//   1. Check tomorrow's calendar event count → busier tomorrow = earlier, more urgent nudge.
//   2. Check current HRV stress → if stress is elevated at this hour, flag it.
//   3. Check today's total steps — under-moved user needs a different message
//      ("try a short walk before bed") vs. over-moved ("rest and recover").
//   4. Check if any timers are running (user set a timer → they're still working).
//   5. Compute a "wind_down_urgency" to decide importance level.

import { runSkill, type SkillBaseResult } from "../_lib.js";
import { db, localDateString, localDayBounds } from "../../db.js";
import { readHrvStress } from "../../pi-engine/fusion.js";
import type { Lang } from "../../i18n.js";

// ── Data helpers ──────────────────────────────────────────────────────────────

type WindDownContext = {
  tomorrow_events: number;
  hrv_stress: number | null;    // null = no watch data
  today_steps: number;
  active_timers: number;
};

function buildContext(now: Date): WindDownContext {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = localDateString(tomorrow);
  const todayDate = localDateString(now);
  const tomorrowBounds = localDayBounds(tomorrow);

  const tomorrow_events = (
    db
      .prepare("SELECT COUNT(*) AS c FROM calendar WHERE start_ts >= ? AND start_ts <= ?")
      .get(tomorrowBounds.start, tomorrowBounds.end) as { c: number } | undefined
  )?.c ?? 0;

  const today_steps = (
    db
      .prepare("SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ?")
      .get(todayDate) as { c: number } | undefined
  )?.c ?? 0;

  const active_timers = (
    db
      .prepare("SELECT COUNT(*) AS c FROM timers WHERE fired = 0 AND end_ts > ?")
      .get(now.toISOString()) as { c: number } | undefined
  )?.c ?? 0;

  const hrv = readHrvStress();

  return {
    tomorrow_events,
    hrv_stress: Number.isFinite(hrv) ? hrv : null,
    today_steps,
    active_timers,
  };
}

// ── Urgency calculation ───────────────────────────────────────────────────────

function windDownUrgency(ctx: WindDownContext): number {
  let score = 0.3; // baseline: it's wind-down time, always relevant

  // Packed tomorrow → more urgency to sleep early.
  if (ctx.tomorrow_events >= 5) score += 0.4;
  else if (ctx.tomorrow_events >= 3) score += 0.25;

  // Elevated evening stress → user needs active wind-down.
  if (ctx.hrv_stress !== null && ctx.hrv_stress > 0.6) score += 0.25;

  // Active timers → user is still mid-task, suppress a bit.
  if (ctx.active_timers > 0) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

// ── Text builder ──────────────────────────────────────────────────────────────

function buildText(lang: Lang, ctx: WindDownContext): string {
  const stressHint =
    ctx.hrv_stress !== null && ctx.hrv_stress > 0.6
      ? lang === "hi"
        ? " आपका स्ट्रेस अभी भी ऊँचा है।"
        : lang === "kn"
          ? " ನಿಮ್ಮ ಒತ್ತಡ ಇನ್ನೂ ಹೆಚ್ಚಾಗಿದೆ."
          : " Your stress is still elevated."
      : "";

  const tomorrowHint =
    ctx.tomorrow_events >= 3
      ? lang === "hi"
        ? ` कल ${ctx.tomorrow_events} इवेंट हैं — अच्छी नींद लें।`
        : lang === "kn"
          ? ` ನಾಳೆ ${ctx.tomorrow_events} ಕಾರ್ಯಕ್ರಮಗಳಿವೆ — ಚೆನ್ನಾಗಿ ಮಲಗಿ.`
          : ` Tomorrow has ${ctx.tomorrow_events} events — early sleep will help.`
      : "";

  const stepHint =
    ctx.today_steps < 3000
      ? lang === "hi"
        ? " आज ज़्यादा नहीं चले — सोने से पहले एक छोटी वॉक करें।"
        : lang === "kn"
          ? " ಇಂದು ಹೆಚ್ಚು ನಡೆದಿಲ್ಲ — ಮಲಗುವ ಮೊದಲು ಸ್ವಲ್ಪ ನಡೆಯಿರಿ."
          : " You moved little today — a short walk before bed improves sleep."
      : ctx.today_steps > 12000
        ? lang === "hi"
          ? " ख़ूब चले आज — आराम करें।"
          : lang === "kn"
            ? " ಇಂದು ಸಾಕಷ್ಟು ನಡೆದಿದ್ದೀರಿ — ವಿಶ್ರಾಂತಿ ತೆಗೆದುಕೊಳ್ಳಿ."
            : " Great movement today — rest and recover."
        : "";

  if (lang === "hi") {
    return `Wind-down time.${stressHint}${tomorrowHint}${stepHint} लाइट कम करें, लैपटॉप बंद करें।`;
  }
  if (lang === "kn") {
    return `ವಿಶ್ರಾಂತಿಯ ಸಮಯ.${stressHint}${tomorrowHint}${stepHint} ದೀಪ ಕಡಿಮೆ ಮಾಡಿ, ಲ್ಯಾಪ್‌ಟಾಪ್ ಮುಚ್ಚಿ.`;
  }
  return `Wind-down time.${stressHint}${tomorrowHint}${stepHint} Dim the lights, close the laptop, breathe.`;
}

// ── Skill entry point ─────────────────────────────────────────────────────────

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang; prewarm?: boolean } = {},
): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  const ctx = buildContext(now);
  const urgency = windDownUrgency(ctx);

  // If a timer is running, user isn't ready — suppress entirely.
  if (ctx.active_timers > 0 && urgency < 0.5) {
    return runSkill(
      {
        skill: "wind_down",
        importance: "low",
        buildText: ({ lang }) => buildText(lang, ctx),
      },
      { ...opts, dry_run: true }, // silent: user still working
    );
  }

  const importance =
    urgency >= 0.7 ? "high" : urgency >= 0.45 ? "normal" : "low";

  return runSkill(
    {
      skill: "wind_down",
      importance,
      buildText: ({ lang }) => buildText(lang, ctx),
      systemPrompt:
        "You are AURA. It's late evening — time for the user to wind down. " +
        "Write a calm, concise 1-2 sentence wind-down nudge. " +
        "Mention tomorrow's event count and stress level if given in the context. " +
        "Tone: warm, gentle, not alarming.",
    },
    opts,
  );
}
