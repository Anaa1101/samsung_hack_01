import { computeScore, type ScoreBreakdown } from "../../score/compute.js";
import { db, recordEvent, recordNotification } from "../../db.js";
import { shouldIntervene, type GateContext, type ProposedAction } from "../../pi-engine/gate.js";
import { applyShadow, shadowReview } from "../../pi-engine/shadow.js";
import { critique } from "../../pi-engine/adversary.js";
import { loadSoul } from "../../soul.js";
import { loadTwin } from "../../twin.js";
import { narrate } from "../../gateway/ollama.js";
import { sendTelegram } from "../../gateway/telegram.js";
import { speak } from "../../gateway/voice.js";
import { append as auditAppend } from "../../audit/log.js";
import { type Lang } from "../../i18n.js";

export type ReminderResult = {
  score: ScoreBreakdown;
  decision: ReturnType<typeof shouldIntervene>;
  next_event: { title: string | null; min_until: number | null };
  message?: { text: string; source: string; channel: string; skill_run_id: number };
  vetoed?: { reason: string };
  dry_run: boolean;
};

const REMIND_WINDOW_MIN = 10;

function getNextEvent(now: Date): { id: number | null; title: string | null; min_until: number | null } {
  const row = db
    .prepare(
      "SELECT id, title, start_ts FROM calendar WHERE start_ts > ? ORDER BY start_ts ASC LIMIT 1",
    )
    .get(now.toISOString()) as { id: number; title: string; start_ts: string } | undefined;
  if (!row) return { id: null, title: null, min_until: null };
  return {
    id: row.id,
    title: row.title,
    min_until: Math.round((new Date(row.start_ts).getTime() - now.getTime()) / 60000),
  };
}

// Don't nudge for the same event twice in the same window.
function alreadyRemindedRecently(eventTitle: string, now: Date): boolean {
  const since = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      "SELECT id FROM skill_runs WHERE skill = 'meeting_reminder' AND ts >= ? AND payload LIKE ? ORDER BY id DESC LIMIT 1",
    )
    .get(since, `%${eventTitle}%`) as { id: number } | undefined;
  return !!row;
}

function fallback(title: string, min: number, lang: Lang): string {
  if (lang === "hi") return `${title} ${min} मिनट में।`;
  if (lang === "kn") return `${title} ${min} ನಿಮಿಷದಲ್ಲಿ.`;
  return `${title} in ${min} min.`;
}

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {},
): Promise<ReminderResult> {
  const now = opts.now ?? new Date();
  const dry_run = opts.dry_run ?? false;
  const lang: Lang = opts.lang ?? "en";

  const score = computeScore(now);
  const next = getNextEvent(now);

  // Nothing on deck or too far away → silent, no audit churn.
  if (
    next.title === null ||
    next.min_until === null ||
    next.min_until > REMIND_WINDOW_MIN ||
    next.min_until < 0
  ) {
    return {
      score,
      decision: {
        intervene: false,
        mode: "fast",
        p_need: 0,
        p_accept: 0,
        c_fa: 0,
        c_fn: 0,
        tau: 1,
        utility: 0,
        context_label: "default",
        reason: next.title === null ? "no event on deck" : `next event in ${next.min_until} min, outside window`,
        calibration_status: "bootstrapping" as const,
        n_samples: 0,
        fusion: { p_need: 0, signals: { calendar_density: 0, step_deficit: 0, notif_burden: 0, hrv_stress: NaN, time_urgency: 0 }, weights: { calendar_density: 0, step_deficit: 0, notif_burden: 0, hrv_stress: 0, time_urgency: 0 }, method: "fallback" as const },
      },
      next_event: next,
      dry_run,
    };
  }

  if (alreadyRemindedRecently(next.title, now)) {
    return {
      score,
      decision: {
        intervene: false,
        mode: "fast",
        p_need: 0,
        p_accept: 0,
        c_fa: 0,
        c_fn: 0,
        tau: 1,
        utility: 0,
        context_label: "default",
        reason: "already reminded for this event in the last 15 min",
        calibration_status: "bootstrapping" as const,
        n_samples: 0,
        fusion: { p_need: 0, signals: { calendar_density: 0, step_deficit: 0, notif_burden: 0, hrv_stress: NaN, time_urgency: 0 }, weights: { calendar_density: 0, step_deficit: 0, notif_burden: 0, hrv_stress: 0, time_urgency: 0 }, method: "fallback" as const },
      },
      next_event: next,
      dry_run,
    };
  }

  const importance: ProposedAction["importance"] = next.min_until <= 5 ? "high" : "normal";
  const action: ProposedAction = {
    skill: "meeting_reminder",
    text: `${next.title} in ${next.min_until} min`,
    importance,
  };
  const ctx: GateContext = {
    now,
    score,
    next_event_min_until: next.min_until,
    next_event_title: next.title,
  };

  let decision = shouldIntervene(action, ctx, loadSoul(), loadTwin(), score);
  if (decision.mode === "slow" && !dry_run) {
    const v = await shadowReview(action, ctx, decision);
    decision = applyShadow(decision, v);
  }

  // Adversary check — can veto even if gate said go.
  const adversary = critique(action, ctx, decision);
  if (decision.intervene && adversary.veto) {
    auditAppend("gate_decision", {
      skill: "meeting_reminder",
      p_need: decision.p_need,
      p_accept: decision.p_accept,
      c_fa: decision.c_fa,
      c_fn: decision.c_fn,
      threshold: decision.tau,
      calibration_status: decision.calibration_status,
      n_samples: decision.n_samples,
      decision,
      score_total: score.total,
      next_event: next,
      adversary,
      vetoed: true,
      dry_run,
    });
    return { score, decision, next_event: next, vetoed: { reason: adversary.reason }, dry_run };
  }

  auditAppend("gate_decision", {
    skill: "meeting_reminder",
    p_need: decision.p_need,
    p_accept: decision.p_accept,
    c_fa: decision.c_fa,
    c_fn: decision.c_fn,
    threshold: decision.tau,
    calibration_status: decision.calibration_status,
    n_samples: decision.n_samples,
    decision,
    score_total: score.total,
    next_event: next,
    adversary,
    dry_run,
  });

  if (dry_run || !decision.intervene) {
    return { score, decision, next_event: next, dry_run };
  }

  const fb = fallback(next.title, next.min_until, lang);
  const langInstruction =
    lang === "hi"
      ? "Respond in Hindi (Devanagari)."
      : lang === "kn"
        ? "Respond in Kannada (ಕನ್ನಡ)."
        : "Respond in English.";
  const llm = await narrate({
    system: `You are AURA. One short sentence (<=120 chars). Lead with the meeting name and time. ${langInstruction}`,
    user: `Event "${next.title}" starts in ${next.min_until} minutes. Remind the user.`,
    fallback: fb,
  });

  const sent = await sendTelegram(llm.text);
  const voiced = speak(llm.text);

  const ins = db
    .prepare("INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)")
    .run(
      now.toISOString(),
      "meeting_reminder",
      null,
      null,
      JSON.stringify({
        text: llm.text,
        event: next.title,
        min_until: next.min_until,
        event_id: next.id,
      }),
    );
  const skill_run_id = Number(ins.lastInsertRowid);

  recordEvent("notification_sent", { skill: "meeting_reminder", channel: sent.channel });
  recordNotification("meeting_reminder");
  auditAppend("notification_sent", {
    skill: "meeting_reminder",
    channel: sent.channel,
    source: llm.source,
    text: llm.text,
    spoken: voiced.spoken,
    skill_run_id,
  });

  return {
    score,
    decision,
    next_event: next,
    message: { text: llm.text, source: llm.source, channel: sent.channel, skill_run_id },
    dry_run: false,
  };
}
