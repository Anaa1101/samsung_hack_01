import { computeScore, type ScoreBreakdown } from "../../score/compute.js";
import { db, recordEvent } from "../../db.js";
import { shouldIntervene, type GateContext, type ProposedAction } from "../../pi-engine/gate.js";
import { applyShadow, shadowReview } from "../../pi-engine/shadow.js";
import { critique } from "../../pi-engine/adversary.js";
import { loadSoul } from "../../soul.js";
import { loadTwin } from "../../twin.js";
import { narrate } from "../../gateway/ollama.js";
import { sendTelegram } from "../../gateway/telegram.js";
import { speak } from "../../gateway/voice.js";
import { getWeather, type WeatherSnapshot } from "../../gateway/weather.js";
import { append as auditAppend } from "../../audit/log.js";
import { commuteNudge, type Lang } from "../../i18n.js";

const BASELINE_COMMUTE_MIN = 30;
const RAIN_BUFFER_MIN = 10;

export type CommuteResult = {
  score: ScoreBreakdown;
  decision: ReturnType<typeof shouldIntervene>;
  weather: WeatherSnapshot;
  next_event: { title: string | null; min_until: number | null };
  recommendation: { leave_in_min: number; reason: string } | null;
  message?: { text: string; source: string; channel: string; skill_run_id: number };
  dry_run: boolean;
};

function getNextOfficeEvent(now: Date): { title: string | null; min_until: number | null } {
  const row = db
    .prepare(
      "SELECT title, start_ts FROM calendar WHERE start_ts > ? ORDER BY start_ts ASC LIMIT 1",
    )
    .get(now.toISOString()) as { title: string; start_ts: string } | undefined;
  if (!row) return { title: null, min_until: null };
  return {
    title: row.title,
    min_until: Math.round((new Date(row.start_ts).getTime() - now.getTime()) / 60000),
  };
}

function fallbackMessage(
  rec: { leave_in_min: number; reason: string },
  weather: WeatherSnapshot,
  lang: Lang,
): string {
  return commuteNudge(lang, {
    leaveInMin: rec.leave_in_min,
    reason: rec.reason,
    tempC: weather.temp_c,
  });
}

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {},
): Promise<CommuteResult> {
  const now = opts.now ?? new Date();
  const dry_run = opts.dry_run ?? false;
  const lang: Lang = opts.lang ?? "en";
  const score = computeScore(now);
  const next = getNextOfficeEvent(now);
  const weather = await getWeather();

  let recommendation: { leave_in_min: number; reason: string } | null = null;
  let importance: ProposedAction["importance"] = "normal";

  if (next.min_until !== null) {
    const commuteNeeded = BASELINE_COMMUTE_MIN + (weather.is_raining_soon ? RAIN_BUFFER_MIN : 0);
    const leaveIn = next.min_until - commuteNeeded;
    const reasons: string[] = [];
    if (weather.is_raining_soon) reasons.push("rain expected");
    if (leaveIn <= 5) reasons.push("tight buffer");
    if (reasons.length > 0) {
      recommendation = {
        leave_in_min: Math.max(0, leaveIn),
        reason: reasons.join(", "),
      };
      if (leaveIn <= 0) importance = "critical";
      else if (leaveIn <= 10) importance = "high";
    }
  }

  const action: ProposedAction = {
    skill: "commute_guardian",
    text: recommendation ? `leave in ${recommendation.leave_in_min} min` : "no commute action",
    importance,
  };
  const ctx: GateContext = {
    now,
    score,
    next_event_min_until: next.min_until,
    next_event_title: next.title,
  };
  let decision = shouldIntervene(action, ctx, loadSoul(), loadTwin());
  if (decision.mode === "slow" && !dry_run) {
    const verdict = await shadowReview(action, ctx, decision);
    decision = applyShadow(decision, verdict);
  }
  const adversary = critique(action, ctx, decision);
  if (decision.intervene && adversary.veto) {
    auditAppend("gate_decision", {
      skill: "commute_guardian",
      p_need: decision.p_need,
      p_accept: decision.p_accept,
      c_fa: decision.c_fa,
      c_fn: decision.c_fn,
      threshold: decision.tau,
      calibration_status: decision.calibration_status,
      n_samples: decision.n_samples,
      decision,
      adversary,
      vetoed: true,
      score_total: score.total,
      next_event: next,
      dry_run,
    });
    return { score, decision, weather, next_event: next, recommendation, dry_run };
  }

  auditAppend("gate_decision", {
    skill: "commute_guardian",
    p_need: decision.p_need,
    p_accept: decision.p_accept,
    c_fa: decision.c_fa,
    c_fn: decision.c_fn,
    threshold: decision.tau,
    calibration_status: decision.calibration_status,
    n_samples: decision.n_samples,
    decision,
    adversary,
    score_total: score.total,
    next_event: next,
    weather: { is_raining_soon: weather.is_raining_soon, temp_c: weather.temp_c },
    recommendation,
    dry_run,
  });

  if (dry_run || !recommendation) {
    return { score, decision, weather, next_event: next, recommendation, dry_run };
  }
  if (!decision.intervene) {
    return { score, decision, weather, next_event: next, recommendation, dry_run: false };
  }

  const fallback = fallbackMessage(recommendation, weather, lang);
  const langInstruction =
    lang === "hi"
      ? "Respond in Hindi (Devanagari script)."
      : lang === "kn"
        ? "Respond in Kannada (ಕನ್ನಡ script)."
        : "Respond in English.";
  const llm = await narrate({
    system: `You are AURA. Write one short message (<=200 chars). No greetings. Lead with the action: leave time. ${langInstruction}`,
    user: `Next event: ${next.title} in ${next.min_until} min.\nLeave in: ${recommendation.leave_in_min} min.\nReason: ${recommendation.reason}.\nTemp: ${Math.round(weather.temp_c)}°C, rain soon: ${weather.is_raining_soon}.\nWrite the nudge.`,
    fallback,
  });

  const sent = await sendTelegram(llm.text);
  const voiced = speak(llm.text);

  const insertRes = db
    .prepare(
      "INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      now.toISOString(),
      "commute_guardian",
      null,
      null,
      JSON.stringify({ text: llm.text, recommendation, weather }),
    );
  const skill_run_id = Number(insertRes.lastInsertRowid);

  recordEvent("notification_sent", { skill: "commute_guardian", channel: sent.channel });
  auditAppend("notification_sent", {
    skill: "commute_guardian",
    channel: sent.channel,
    source: llm.source,
    text: llm.text,
    skill_run_id,
    spoken: voiced.spoken,
  });

  return {
    score,
    decision,
    weather,
    next_event: next,
    recommendation,
    message: { text: llm.text, source: llm.source, channel: sent.channel, skill_run_id },
    dry_run: false,
  };
}
