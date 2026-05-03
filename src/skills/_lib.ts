// Shared helpers used by all skills. Cuts boilerplate.

import { computeScore, type ScoreBreakdown } from "../score/compute.js";
import { db, recordEvent } from "../db.js";
import { shouldIntervene, type GateContext, type ProposedAction } from "../pi-engine/gate.js";
import { applyShadow, shadowReview } from "../pi-engine/shadow.js";
import { critique } from "../pi-engine/adversary.js";
import { loadSoul } from "../soul.js";
import { loadTwin } from "../twin.js";
import { narrate } from "../gateway/ollama.js";
import { sendTelegram } from "../gateway/telegram.js";
import { speak } from "../gateway/voice.js";
import { append as auditAppend } from "../audit/log.js";
import type { Lang } from "../i18n.js";

export type SkillBaseResult = {
  score: ScoreBreakdown;
  decision: ReturnType<typeof shouldIntervene>;
  next_event?: { title: string | null; min_until: number | null };
  message?: { text: string; source: string; channel: string; skill_run_id: number };
  vetoed?: { reason: string };
  dry_run: boolean;
};

export function getNextEvent(now: Date) {
  const row = db
    .prepare("SELECT title, start_ts FROM calendar WHERE start_ts > ? ORDER BY start_ts ASC LIMIT 1")
    .get(now.toISOString()) as { title: string; start_ts: string } | undefined;
  if (!row) return { title: null, min_until: null };
  return {
    title: row.title,
    min_until: Math.round((new Date(row.start_ts).getTime() - now.getTime()) / 60000),
  };
}

export type RunSpec = {
  skill: string;
  importance?: ProposedAction["importance"];
  buildText: (ctx: { lang: Lang; score: ScoreBreakdown; now: Date }) => Promise<string> | string;
  systemPrompt?: string;
  langInstruction?: (lang: Lang) => string;
};

const langInstr = (lang: Lang) =>
  lang === "hi"
    ? "Respond in Hindi (Devanagari)."
    : lang === "kn"
      ? "Respond in Kannada (ಕನ್ನಡ)."
      : "Respond in English.";

export async function runSkill(
  spec: RunSpec,
  opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {},
): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  const dry_run = opts.dry_run ?? false;
  const lang: Lang = opts.lang ?? "en";
  const score = computeScore(now);
  const next = getNextEvent(now);

  const fallback = await spec.buildText({ lang, score, now });

  const action: ProposedAction = {
    skill: spec.skill,
    text: fallback,
    importance: spec.importance ?? "normal",
  };
  const ctx: GateContext = {
    now,
    score,
    next_event_min_until: next.min_until,
    next_event_title: next.title,
  };

  let decision = shouldIntervene(action, ctx, loadSoul(), loadTwin());
  if (decision.mode === "slow" && !dry_run) {
    const v = await shadowReview(action, ctx, decision);
    decision = applyShadow(decision, v);
  }
  const adversary = critique(action, ctx, decision);
  if (decision.intervene && adversary.veto) {
    auditAppend("gate_decision", {
      skill: spec.skill,
      decision,
      adversary,
      vetoed: true,
      score_total: score.total,
      next_event: next,
      dry_run,
    });
    return {
      score,
      decision,
      next_event: next,
      vetoed: { reason: adversary.reason },
      dry_run,
    };
  }
  auditAppend("gate_decision", {
    skill: spec.skill,
    decision,
    adversary,
    score_total: score.total,
    next_event: next,
    dry_run,
  });

  if (dry_run || !decision.intervene) {
    return { score, decision, next_event: next, dry_run };
  }

  const llm = spec.systemPrompt
    ? await narrate({
        system: `${spec.systemPrompt} ${langInstr(lang)}`,
        user: fallback,
        fallback,
      })
    : { text: fallback, source: "fallback" as const };

  const sent = await sendTelegram(llm.text);
  const voiced = speak(llm.text);

  const ins = db
    .prepare("INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)")
    .run(now.toISOString(), spec.skill, null, null, JSON.stringify({ text: llm.text }));
  const skill_run_id = Number(ins.lastInsertRowid);

  recordEvent("notification_sent", { skill: spec.skill, channel: sent.channel });
  auditAppend("notification_sent", {
    skill: spec.skill,
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
