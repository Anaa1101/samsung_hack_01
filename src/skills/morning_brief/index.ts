import { computeScore, type ScoreBreakdown } from "../../score/compute.js";
import { db } from "../../db.js";
import { shouldIntervene, type GateContext, type ProposedAction } from "../../pi-engine/gate.js";
import { applyShadow, shadowReview } from "../../pi-engine/shadow.js";
import { critique } from "../../pi-engine/adversary.js";
import { loadSoul } from "../../soul.js";
import { loadTwin } from "../../twin.js";
import { narrate } from "../../gateway/ollama.js";
import { sendTelegram } from "../../gateway/telegram.js";
import { speak } from "../../gateway/voice.js";
import { append as auditAppend } from "../../audit/log.js";
import { recordEvent } from "../../db.js";
import { componentLabel, morningBrief as briefTemplate, type Lang } from "../../i18n.js";

export type SkillResult = {
  score: ScoreBreakdown;
  decision: ReturnType<typeof shouldIntervene>;
  message?: { text: string; source: string; channel: string; skill_run_id: number };
  dry_run: boolean;
};

function getNextEvent(now: Date): { title: string | null; min_until: number | null } {
  const row = db
    .prepare("SELECT title, start_ts FROM calendar WHERE start_ts > ? ORDER BY start_ts ASC LIMIT 1")
    .get(now.toISOString()) as { title: string; start_ts: string } | undefined;
  if (!row) return { title: null, min_until: null };
  return {
    title: row.title,
    min_until: Math.round((new Date(row.start_ts).getTime() - now.getTime()) / 60000),
  };
}

function topConcernKey(score: ScoreBreakdown): { key: string; pct: number } {
  const entries = Object.entries(score.components).sort((a, b) => a[1] - b[1]);
  const [name, value] = entries[0];
  return { key: name, pct: Math.round(value * 100) };
}

function fallbackMessage(
  score: ScoreBreakdown,
  next: { title: string | null; min_until: number | null },
  lang: Lang,
): string {
  const c = topConcernKey(score);
  return briefTemplate(lang, {
    score: score.total,
    weakest: componentLabel(lang, c.key),
    weakestPct: c.pct,
    nextTitle: next.title,
    nextMin: next.min_until,
  });
}

export async function run(
  opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {},
): Promise<SkillResult> {
  const now = opts.now ?? new Date();
  const dry_run = opts.dry_run ?? false;
  const lang: Lang = opts.lang ?? "en";
  const score = computeScore(now);
  const next = getNextEvent(now);

  const action: ProposedAction = {
    skill: "morning_brief",
    text: "morning_brief",
    importance: "normal",
  };
  const ctx: GateContext = {
    now,
    score,
    next_event_min_until: next.min_until,
    next_event_title: next.title,
  };
  const soul = loadSoul();
  const twin = loadTwin();
  let decision = shouldIntervene(action, ctx, soul, twin);

  if (decision.mode === "slow" && !dry_run) {
    const verdict = await shadowReview(action, ctx, decision);
    decision = applyShadow(decision, verdict);
  }

  const adversary = critique(action, ctx, decision);
  if (decision.intervene && adversary.veto) {
    auditAppend("gate_decision", {
      skill: "morning_brief",
      decision,
      adversary,
      vetoed: true,
      score_total: score.total,
      next_event: next,
      dry_run,
    });
    return { score, decision, dry_run };
  }

  auditAppend("gate_decision", {
    skill: "morning_brief",
    decision,
    adversary,
    score_total: score.total,
    next_event: next,
    dry_run,
  });

  if (dry_run) {
    return { score, decision, dry_run: true };
  }

  if (!decision.intervene) {
    return { score, decision, dry_run: false };
  }

  const fallback = fallbackMessage(score, next, lang);
  const c = topConcernKey(score);
  const langInstruction =
    lang === "hi"
      ? "Respond in Hindi (Devanagari script)."
      : lang === "kn"
        ? "Respond in Kannada (ಕನ್ನಡ script)."
        : "Respond in English.";
  const llm = await narrate({
    system: `You are AURA. Write a single message (<=280 chars). No greetings, no sign-offs. Lead with action or fact. ${langInstruction}`,
    user: `Day readiness: ${score.total}/100.\nWeakest component: ${componentLabel(lang, c.key)}.\nNext event: ${
      next.title ?? "none"
    }${next.min_until !== null ? ` in ${next.min_until} min` : ""}.\nWrite the morning brief.`,
    fallback,
  });

  const sent = await sendTelegram(llm.text);
  const voiced = speak(llm.text);

  const insertRes = db
    .prepare(
      "INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)",
    )
    .run(now.toISOString(), "morning_brief", null, null, JSON.stringify({ text: llm.text }));
  const skill_run_id = Number(insertRes.lastInsertRowid);

  recordEvent("notification_sent", { skill: "morning_brief", channel: sent.channel });

  auditAppend("notification_sent", {
    skill: "morning_brief",
    channel: sent.channel,
    source: llm.source,
    text: llm.text,
    skill_run_id,
    spoken: voiced.spoken,
  });

  return {
    score,
    decision,
    message: { text: llm.text, source: llm.source, channel: sent.channel, skill_run_id },
    dry_run: false,
  };
}
