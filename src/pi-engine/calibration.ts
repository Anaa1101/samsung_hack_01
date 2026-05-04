// Edge-PRISM: on-device acceptance-feedback calibration of PRISM cost weights.
//
// The core research claim: rather than hand-tuning c_fa and c_fn in SOUL.md,
// let the user's own accept/dismiss behaviour drive the threshold τ = c_fa/(c_fa+c_fn)
// toward values that match their revealed preferences — per skill, per time-of-day.
//
// Data source: skill_runs table (columns: accepted, dismissed, ts, skill).
// No new dependencies; no eval-harness code touched.

import { db } from "../db.js";
import type { CostWeights } from "../soul.js";

// ── Hour-of-day buckets ──────────────────────────────────────────────────────
// Four coarse buckets that map naturally to AURA's contexts. JavaScript's
// Date.getHours() returns local time, so the mapping is timezone-correct.

export type HourBucket = "morning" | "daytime" | "evening" | "night";

export function toHourBucket(hour: number): HourBucket {
  if (hour >= 6 && hour < 10) return "morning";
  if (hour >= 10 && hour < 17) return "daytime";
  if (hour >= 17 && hour < 21) return "evening";
  return "night"; // 21-23 and 0-5
}

// ── Calibration result ───────────────────────────────────────────────────────

export type CalibrationResult = {
  c_fa: number;
  c_fn: number;
  n_samples: number;
  status: "calibrated" | "bootstrapping";
};

// MIN_SAMPLES: below this we do not trust the data — fall back to static costs.
// FULL_SAMPLES: at this count the calibration is trusted 100% (blend_weight = 1).
const MIN_SAMPLES = 5;
const FULL_SAMPLES = 20;

/**
 * Edge-PRISM calibration: compute per-context cost weights from accept/dismiss history.
 *
 * The PRISM gate fires when  utility = p_need × p_accept > τ,
 * where  τ = c_fa / (c_fa + c_fn).
 *
 * Calibration math:
 *   accept_rate  = n_accept / n_samples
 *   dismiss_rate = 1 − accept_rate
 *
 *   dismiss_rate ↑  →  c_fa scaled up  →  τ ↑  →  gate speaks less often
 *   accept_rate  ↑  →  c_fn scaled up  →  τ ↓  →  gate speaks more often
 *
 *   Blend weight ramps linearly from 0 (at MIN_SAMPLES) to 1 (at FULL_SAMPLES),
 *   giving a smooth, data-quantity-weighted transition from static to calibrated.
 *   Below MIN_SAMPLES this function returns static costs with status "bootstrapping".
 *
 * @param skill    The AURA skill name (e.g. "morning_brief")
 * @param bucket   Hour-of-day bucket from toHourBucket()
 * @param statics  Static cost weights from SOUL.md for the current SoulContext
 */
export function calibrateCosts(
  skill: string,
  bucket: HourBucket,
  statics: CostWeights,
): CalibrationResult {
  // Fetch all labelled runs for this skill in the last 30 days.
  // Using ts as TEXT and parsing in JS so getHours() returns local time (timezone-safe).
  const rows = db
    .prepare(
      `SELECT ts, accepted, dismissed
       FROM skill_runs
       WHERE skill = ?
         AND ts >= datetime('now', '-30 days')
         AND (accepted IS NOT NULL OR dismissed IS NOT NULL)`,
    )
    .all(skill) as Array<{ ts: string; accepted: number | null; dismissed: number | null }>;

  // Filter to runs that fall in the matching local-time hour bucket.
  const inBucket = rows.filter((r) => toHourBucket(new Date(r.ts).getHours()) === bucket);
  const n_accept = inBucket.filter((r) => r.accepted === 1).length;
  const n_dismiss = inBucket.filter((r) => r.dismissed === 1).length;
  const n_samples = n_accept + n_dismiss;

  // Not enough data: return static costs unchanged, flagged as bootstrapping.
  if (n_samples < MIN_SAMPLES) {
    return {
      c_fa: statics.false_alarm,
      c_fn: statics.missed_help,
      n_samples,
      status: "bootstrapping",
    };
  }

  const accept_rate = n_accept / n_samples;
  const dismiss_rate = 1 - accept_rate;

  // blend_weight ∈ (0, 1]: how much to trust the calibration vs static costs.
  // At MIN_SAMPLES it is just above 0; at FULL_SAMPLES it reaches 1.
  const blend_weight = Math.min(1.0, (n_samples - MIN_SAMPLES) / (FULL_SAMPLES - MIN_SAMPLES));

  // Scale factors derived from empirical feedback.
  // Each is in [1, 2]: multiplied by the static cost, they can at most double it.
  const c_fa_scale = 1 + dismiss_rate; // high dismissals → raise false-alarm cost
  const c_fn_scale = 1 + accept_rate;  // high accepts    → raise missed-help cost

  // Interpolate: blend=0 gives static costs; blend=1 gives fully scaled costs.
  const c_fa = statics.false_alarm * (1 + blend_weight * (c_fa_scale - 1));
  const c_fn = statics.missed_help * (1 + blend_weight * (c_fn_scale - 1));

  return { c_fa, c_fn, n_samples, status: "calibrated" };
}

/**
 * Count distinct skill × hour-bucket contexts that have ≥ MIN_SAMPLES labelled runs.
 * Used for the startup log line: "Edge-PRISM calibration: ACTIVE (N contexts loaded)".
 */
export function countCalibratedContexts(): number {
  const rows = db
    .prepare(
      `SELECT skill, ts
       FROM skill_runs
       WHERE (accepted IS NOT NULL OR dismissed IS NOT NULL)
         AND ts >= datetime('now', '-30 days')`,
    )
    .all() as Array<{ skill: string; ts: string }>;

  // Group by skill + local-time hour bucket, count samples per group.
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.skill}:${toHourBucket(new Date(r.ts).getHours())}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let calibrated = 0;
  for (const n of counts.values()) {
    if (n >= MIN_SAMPLES) calibrated++;
  }
  return calibrated;
}
