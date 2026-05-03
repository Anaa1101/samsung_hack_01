import type { Soul, SoulContext } from "../soul.js";
import type { TwinPatterns } from "../twin.js";
import type { ScoreBreakdown } from "../score/compute.js";

export type GateContext = {
  now: Date;
  score: ScoreBreakdown;
  next_event_min_until: number | null;
  next_event_title: string | null;
};

export type ProposedAction = {
  skill: string;
  text: string;
  importance?: "low" | "normal" | "high" | "critical";
};

export type GateDecision = {
  intervene: boolean;
  mode: "fast" | "slow";
  p_need: number;
  p_accept: number;
  c_fa: number;
  c_fn: number;
  tau: number;
  utility: number;
  context_label: SoulContext;
  reason: string;
};

const MARGIN = 0.05;

function inQuietHours(now: Date, soul: Soul): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sH, sM] = soul.quiet_hours.start.split(":").map(Number);
  const [eH, eM] = soul.quiet_hours.end.split(":").map(Number);
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

import { isInQuietBlock } from "../db.js";

function classifyContext(ctx: GateContext, soul: Soul): SoulContext {
  if (isInQuietBlock(ctx.now).active) return "quiet_hours"; // user-imposed DND wins
  if (inQuietHours(ctx.now, soul)) return "quiet_hours";
  const t = ctx.next_event_title?.toLowerCase() ?? "";
  if (t.includes("focus") || t.includes("deep work")) return "focus_block";
  if (ctx.next_event_min_until !== null && ctx.next_event_min_until <= 60) return "pre_meeting";
  const h = ctx.now.getHours();
  if ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)) return "commute";
  return "default";
}

// p_need: how likely the user actually needs this nudge right now.
// Driven by readiness score (low score → more help needed) plus situational urgency.
function estimateNeed(action: ProposedAction, ctx: GateContext): number {
  const lowReadiness = 1 - ctx.score.total / 100;
  let situational = 0;
  if (ctx.next_event_min_until !== null && ctx.next_event_min_until <= 30) {
    situational = 0.6;
  } else if (ctx.next_event_min_until !== null && ctx.next_event_min_until <= 60) {
    situational = 0.35;
  }
  if (action.importance === "critical") situational = Math.max(situational, 0.9);
  if (action.importance === "high") situational = Math.max(situational, 0.6);
  // Combine: take the max so a high-readiness user still gets pre-meeting nudges.
  const raw = Math.max(lowReadiness * 0.7, situational);
  return Math.min(1, raw);
}

// p_accept: if AURA spoke now, how likely is the user to accept this nudge?
// Pulled from TWIN's per-skill historical acceptance rate, dampened by recent fatigue.
function estimateAccept(
  action: ProposedAction,
  ctx: GateContext,
  twin: TwinPatterns,
): number {
  const base = twin.acceptance_rate[action.skill] ?? 0.6;
  // Fatigue penalty: each recent notification trims acceptance by 5%, capped at 50%.
  const fatigue = Math.min(0.5, twin.notif_24h * 0.05);
  return Math.max(0.05, base - fatigue);
}

export function shouldIntervene(
  action: ProposedAction,
  ctx: GateContext,
  soul: Soul,
  twin: TwinPatterns,
): GateDecision {
  const context_label = classifyContext(ctx, soul);
  const weights = soul.cost_weights[context_label] ?? soul.cost_weights.default;

  const p_need = estimateNeed(action, ctx);
  const p_accept = estimateAccept(action, ctx, twin);

  const c_fa = weights.false_alarm;
  const c_fn = weights.missed_help;
  const tau = c_fa / (c_fa + c_fn);

  const utility = p_need * p_accept;

  // Critical messages bypass the gate (still recorded).
  if (action.importance === "critical") {
    return {
      intervene: true,
      mode: "fast",
      p_need,
      p_accept,
      c_fa,
      c_fn,
      tau,
      utility,
      context_label,
      reason: "critical override",
    };
  }

  if (utility > tau + MARGIN) {
    return {
      intervene: true,
      mode: "fast",
      p_need,
      p_accept,
      c_fa,
      c_fn,
      tau,
      utility,
      context_label,
      reason: `fast accept: utility ${utility.toFixed(3)} > tau+margin ${(tau + MARGIN).toFixed(3)}`,
    };
  }
  if (utility < tau - MARGIN) {
    return {
      intervene: false,
      mode: "fast",
      p_need,
      p_accept,
      c_fa,
      c_fn,
      tau,
      utility,
      context_label,
      reason: `fast reject: utility ${utility.toFixed(3)} < tau-margin ${(tau - MARGIN).toFixed(3)}`,
    };
  }

  // Borderline: slow-mode counterfactual.
  // "If I stay silent and the predicted bad outcome happens, what's the regret?"
  const regret_if_silent = p_need * c_fn;
  const cost_if_speak = (1 - p_accept) * c_fa;
  const intervene = regret_if_silent > cost_if_speak;
  return {
    intervene,
    mode: "slow",
    p_need,
    p_accept,
    c_fa,
    c_fn,
    tau,
    utility,
    context_label,
    reason: `slow: regret_if_silent ${regret_if_silent.toFixed(3)} ${
      intervene ? ">" : "<="
    } cost_if_speak ${cost_if_speak.toFixed(3)}`,
  };
}
