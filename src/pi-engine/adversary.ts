// The Adversary — AURA's inner critic.
//
// Where the gate asks "is the expected benefit > burden?", the adversary asks
// the opposite question: "what could go wrong if I speak right now?". It runs
// AFTER the gate (and after Shadow AURA on slow decisions) and can VETO a
// proposed notification if multiple objections fire.
//
// Adversary is intentionally deterministic (no LLM): every veto has a stated,
// inspectable reason. Pair it with Shadow AURA — Shadow argues both sides;
// Adversary only argues the "no" side. Two perspectives = harder to over-nudge.

import { db, isInQuietBlock } from "../db.js";
import { append as auditAppend } from "../audit/log.js";
import type { GateContext, GateDecision, ProposedAction } from "./gate.js";
import { loadTwin } from "../twin.js";

export type Objection = {
  code: string;
  weight: number; // 0..1
  reason: string;
};

export type AdversaryVerdict = {
  veto: boolean;
  total_weight: number;
  threshold: number;
  objections: Objection[];
  reason: string;
};

const VETO_THRESHOLD = 1.2; // sum of weights above this → veto

function recentNotificationCount(now: Date, hours = 6): number {
  const since = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM skill_runs WHERE ts >= ?")
    .get(since) as { c: number } | undefined;
  return row?.c ?? 0;
}

function lastNotificationAge(now: Date): number | null {
  const row = db
    .prepare("SELECT ts FROM skill_runs ORDER BY id DESC LIMIT 1")
    .get() as { ts: string } | undefined;
  if (!row) return null;
  return Math.round((now.getTime() - new Date(row.ts).getTime()) / 60000);
}

function recentDismissalsForSkill(skill: string): { dismissed: number; accepted: number } {
  const rows = db
    .prepare(
      "SELECT accepted, dismissed FROM skill_runs WHERE skill = ? AND (accepted IS NOT NULL OR dismissed IS NOT NULL) ORDER BY id DESC LIMIT 3",
    )
    .all(skill) as Array<{ accepted: number | null; dismissed: number | null }>;
  let dismissed = 0;
  let accepted = 0;
  for (const r of rows) {
    if (r.dismissed === 1) dismissed++;
    if (r.accepted === 1) accepted++;
  }
  return { dismissed, accepted };
}

export function critique(
  action: ProposedAction,
  ctx: GateContext,
  gate: GateDecision,
): AdversaryVerdict {
  const objections: Objection[] = [];
  const now = ctx.now;

  // 1. User-imposed quiet block trumps everything except critical importance.
  const quiet = isInQuietBlock(now);
  if (quiet.active && action.importance !== "critical") {
    objections.push({
      code: "user_dnd",
      weight: 2.0,
      reason: `User asked for quiet until ${quiet.until} ("${quiet.reason ?? ""}").`,
    });
  }

  // 2. Notification fatigue: too many in the last 6h.
  const recent6 = recentNotificationCount(now, 6);
  if (recent6 >= 4) {
    objections.push({
      code: "fatigue_6h",
      weight: 0.8,
      reason: `${recent6} notifications in last 6h — adding more risks burnout.`,
    });
  } else if (recent6 >= 2) {
    objections.push({
      code: "fatigue_warn",
      weight: 0.4,
      reason: `${recent6} notifications in last 6h — be selective.`,
    });
  }

  // 3. Just spoke — give the user breathing room.
  const ageMin = lastNotificationAge(now);
  if (ageMin !== null && ageMin < 10 && action.importance !== "critical") {
    objections.push({
      code: "echo_too_soon",
      weight: 0.7,
      reason: `Last spoke ${ageMin} min ago. Two pings in 10 min looks needy.`,
    });
  }

  // 4. The user has been dismissing this exact skill recently.
  const hist = recentDismissalsForSkill(action.skill);
  if (hist.dismissed >= 2 && hist.accepted === 0) {
    objections.push({
      code: "rejected_pattern",
      weight: 0.9,
      reason: `User dismissed the last ${hist.dismissed} ${action.skill} notifications. They're telling us no.`,
    });
  }

  // 5. Day-readiness is high and there's no event imminent → user is fine, don't pile on.
  if (
    ctx.score.total >= 80 &&
    (ctx.next_event_min_until === null || ctx.next_event_min_until > 60) &&
    action.importance !== "critical"
  ) {
    objections.push({
      code: "user_already_ok",
      weight: 0.5,
      reason: `Readiness ${ctx.score.total}/100 + no near-term event. No real signal to interrupt.`,
    });
  }

  // 6. Twin-level burden score is climbing.
  const twin = loadTwin();
  if (twin.notif_24h >= 8) {
    objections.push({
      code: "burden_24h",
      weight: 0.6,
      reason: `${twin.notif_24h} notifications in last 24h. Burden score is rising.`,
    });
  }

  // 7. Gate decision was already weak (utility close to threshold).
  if (gate.intervene && gate.utility < gate.tau + 0.02 && action.importance !== "critical") {
    objections.push({
      code: "weak_gate",
      weight: 0.3,
      reason: `Gate utility ${gate.utility.toFixed(3)} barely cleared τ ${gate.tau.toFixed(3)}.`,
    });
  }

  const total_weight = objections.reduce((s, o) => s + o.weight, 0);
  // Critical messages can't be vetoed by the adversary (they bypass).
  const veto =
    action.importance !== "critical" && total_weight >= VETO_THRESHOLD;

  const verdict: AdversaryVerdict = {
    veto,
    total_weight: Number(total_weight.toFixed(2)),
    threshold: VETO_THRESHOLD,
    objections,
    reason: veto
      ? `VETOED (weight ${total_weight.toFixed(2)} ≥ ${VETO_THRESHOLD}): ${objections.map((o) => o.code).join(", ")}`
      : objections.length === 0
        ? "no objections"
        : `noted but did not veto (weight ${total_weight.toFixed(2)} < ${VETO_THRESHOLD})`,
  };

  auditAppend("adversary_review", {
    skill: action.skill,
    gate_intervene: gate.intervene,
    verdict,
  });

  return verdict;
}
