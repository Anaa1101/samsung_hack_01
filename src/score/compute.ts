import { db } from "../db.js";

export type ScoreBreakdown = {
  total: number;
  components: {
    sleep: number;
    morning_activity: number;
    calendar_prep: number;
    commute_buffer: number;
    notifications: number;
    focus_time: number;
    meeting_load: number;
  };
  inputs: {
    sleep_min: number;
    morning_steps: number;
    next_event_min_until: number | null;
    notif_24h: number;
    meeting_minutes_today: number;
    free_blocks_min: number;
    commute_buffer_min: number;
  };
  computed_at: string;
};

const WEIGHTS = {
  sleep: 0.20,
  morning_activity: 0.15,
  calendar_prep: 0.20,
  commute_buffer: 0.15,
  notifications: 0.10,
  focus_time: 0.10,
  meeting_load: 0.10,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function todayDateString(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getSleepMin(now: Date): number {
  const date = todayDateString(now);
  const row = db
    .prepare("SELECT duration_min FROM sleep WHERE date = ?")
    .get(date) as { duration_min: number } | undefined;
  return row?.duration_min ?? 0;
}

function getMorningSteps(now: Date): number {
  const date = todayDateString(now);
  const row = db
    .prepare("SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ? AND hour < 10")
    .get(date) as { c: number } | undefined;
  return row?.c ?? 0;
}

function getNextEventMinutesUntil(now: Date): number | null {
  const row = db
    .prepare("SELECT start_ts FROM calendar WHERE start_ts > ? ORDER BY start_ts ASC LIMIT 1")
    .get(now.toISOString()) as { start_ts: string } | undefined;
  if (!row) return null;
  return Math.round((new Date(row.start_ts).getTime() - now.getTime()) / 60000);
}

function getNotifications24h(now: Date): number {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE ts >= ?")
    .get(since) as { c: number } | undefined;
  return row?.c ?? 0;
}

function getMeetingMinutesToday(now: Date): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const rows = db
    .prepare("SELECT start_ts, end_ts FROM calendar WHERE start_ts >= ? AND start_ts <= ?")
    .all(start.toISOString(), end.toISOString()) as Array<{ start_ts: string; end_ts: string }>;
  let total = 0;
  for (const r of rows) {
    total += (new Date(r.end_ts).getTime() - new Date(r.start_ts).getTime()) / 60000;
  }
  return Math.round(total);
}

function getFreeBlocksMinutes(now: Date): number {
  const start = new Date(now);
  start.setHours(8, 0, 0, 0);
  const end = new Date(now);
  end.setHours(18, 0, 0, 0);
  const rows = db
    .prepare(
      "SELECT start_ts, end_ts FROM calendar WHERE end_ts > ? AND start_ts < ? ORDER BY start_ts",
    )
    .all(start.toISOString(), end.toISOString()) as Array<{ start_ts: string; end_ts: string }>;
  let cursor = start.getTime();
  let largest = 0;
  for (const r of rows) {
    const s = new Date(r.start_ts).getTime();
    if (s > cursor) largest = Math.max(largest, (s - cursor) / 60000);
    cursor = Math.max(cursor, new Date(r.end_ts).getTime());
  }
  if (end.getTime() > cursor) largest = Math.max(largest, (end.getTime() - cursor) / 60000);
  return Math.round(largest);
}

function getCommuteBufferMin(now: Date, nextEventMinUntil: number | null): number {
  if (nextEventMinUntil === null) return 60;
  // Commute baseline 30 min. Buffer = time-until-event minus commute.
  return Math.max(0, nextEventMinUntil - 30);
}

export function computeScore(now: Date = new Date()): ScoreBreakdown {
  const sleep_min = getSleepMin(now);
  const morning_steps = getMorningSteps(now);
  const next_event_min_until = getNextEventMinutesUntil(now);
  const notif_24h = getNotifications24h(now);
  const meeting_minutes_today = getMeetingMinutesToday(now);
  const free_blocks_min = getFreeBlocksMinutes(now);
  const commute_buffer_min = getCommuteBufferMin(now, next_event_min_until);

  // Sleep: 7-9h is optimal (420-540 min). Linear falloff.
  const sleepScore = clamp01(1 - Math.abs(sleep_min - 480) / 240);

  // Morning activity: 0 → 0, 3000+ steps by 10am → 1.0
  const activityScore = clamp01(morning_steps / 3000);

  // Calendar prep: full score if no event soon OR >= 30 min until next event.
  const prepScore =
    next_event_min_until === null
      ? 1
      : clamp01(next_event_min_until / 30);

  // Commute buffer: 0 → 0.0, 20+ min → 1.0
  const commuteScore = clamp01(commute_buffer_min / 20);

  // Notifications: 0 = great, 30+ = saturated
  const notifScore = clamp01(1 - notif_24h / 30);

  // Focus time: largest free block. 60 → 0.5, 120+ → 1.0
  const focusScore = clamp01(free_blocks_min / 120);

  // Meeting load: 0 → 1.0, 360+ min → 0.0
  const meetingScore = clamp01(1 - meeting_minutes_today / 360);

  const components = {
    sleep: sleepScore,
    morning_activity: activityScore,
    calendar_prep: prepScore,
    commute_buffer: commuteScore,
    notifications: notifScore,
    focus_time: focusScore,
    meeting_load: meetingScore,
  };

  let weighted = 0;
  for (const [k, v] of Object.entries(components)) {
    weighted += v * WEIGHTS[k as keyof typeof WEIGHTS];
  }
  const total = Math.round(weighted * 100);

  return {
    total,
    components,
    inputs: {
      sleep_min,
      morning_steps,
      next_event_min_until,
      notif_24h,
      meeting_minutes_today,
      free_blocks_min,
      commute_buffer_min,
    },
    computed_at: now.toISOString(),
  };
}
