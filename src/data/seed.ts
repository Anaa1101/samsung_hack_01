import { db, localDateString } from "../db.js";

function isoOffset(now: Date, offsetMin: number): string {
  return new Date(now.getTime() + offsetMin * 60 * 1000).toISOString();
}

function todayAt(now: Date, hour: number, min = 0): Date {
  const d = new Date(now);
  d.setHours(hour, min, 0, 0);
  return d;
}

function dateStr(d: Date): string {
  return localDateString(d);
}

export function seed(now: Date = new Date()): void {
  console.log("[seed] resetting demo data...");
  db.exec(
    "DELETE FROM calendar; DELETE FROM sleep; DELETE FROM steps; DELETE FROM notifications; DELETE FROM skill_runs; DELETE FROM events;",
  );

  // Calendar: today, with one upcoming meeting in 45 min and several through the day.
  const today = now;
  const cal = db.prepare(
    "INSERT INTO calendar (start_ts, end_ts, title, location) VALUES (?, ?, ?, ?)",
  );

  const upcoming = isoOffset(now, 45);
  const upcomingEnd = isoOffset(now, 75);
  cal.run(upcoming, upcomingEnd, "Standup", "Office");

  cal.run(
    todayAt(today, 11, 0).toISOString(),
    todayAt(today, 12, 0).toISOString(),
    "Design review",
    "Office",
  );
  cal.run(
    todayAt(today, 14, 0).toISOString(),
    todayAt(today, 15, 0).toISOString(),
    "1:1 with manager",
    "Office",
  );
  cal.run(
    todayAt(today, 16, 30).toISOString(),
    todayAt(today, 17, 30).toISOString(),
    "Investor pitch",
    "Office",
  );

  // Sleep — 14 days back, with a slight drift (later wake times recently)
  const sleepStmt = db.prepare(
    "INSERT INTO sleep (date, duration_min, quality) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const drift = i < 5 ? -10 : 0; // recent days slightly less sleep
    sleepStmt.run(dateStr(d), 450 + drift + Math.round(Math.random() * 40 - 20), 0.7);
  }

  // Steps — 14 days. Each day pattern: low until wake hour, high in morning, moderate mid-day, low evening.
  const stepStmt = db.prepare(
    "INSERT INTO steps (date, hour, count) VALUES (?, ?, ?)",
  );
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    const date = dateStr(d);
    // Wake time drifts later for recent days (7:00 historically, ~7:30 recently).
    const wakeHour = dayOffset < 5 ? 7 : 7;
    const wakeMin = dayOffset < 5 ? 30 : 0;
    const isToday = dayOffset === 0;
    const lastHour = isToday ? Math.max(wakeHour, now.getHours()) : 22;
    for (let h = 5; h <= lastHour; h++) {
      let count: number;
      if (h < wakeHour) count = 5; // sleeping
      else if (h === wakeHour) count = wakeMin > 30 ? 50 : 800; // wake transition
      else if (h < 9) count = 1500; // morning routine
      else if (h < 12) count = 600; // at desk
      else if (h < 14) count = 1200; // lunch
      else if (h < 18) count = 500; // afternoon desk
      else if (h < 21) count = 800; // commute home + dinner
      else count = 200; // wind down
      stepStmt.run(date, h, count);
    }
  }

  // Notifications — 5 from the last 24h
  const notifStmt = db.prepare(
    "INSERT INTO notifications (ts, source, cleared) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < 5; i++) {
    notifStmt.run(isoOffset(now, -60 * (i + 1)), "slack", 0);
  }

  // Skill run history — 14 days of morning briefs and a few commute_guardian.
  // Acceptance rate: 11/14 ~= 0.79 for morning_brief, 4/6 ~= 0.67 for commute_guardian.
  const runStmt = db.prepare(
    "INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)",
  );
  const briefDecisions = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1];
  for (let i = 0; i < briefDecisions.length; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (i + 1));
    d.setHours(7, 35, 0, 0);
    const accepted = briefDecisions[i];
    runStmt.run(
      d.toISOString(),
      "morning_brief",
      accepted,
      accepted === 1 ? 0 : 1,
      JSON.stringify({ seeded: true }),
    );
  }
  const commuteDecisions = [1, 0, 1, 1, 0, 1];
  for (let i = 0; i < commuteDecisions.length; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - (i + 1));
    d.setHours(8, 15, 0, 0);
    const accepted = commuteDecisions[i];
    runStmt.run(
      d.toISOString(),
      "commute_guardian",
      accepted,
      accepted === 1 ? 0 : 1,
      JSON.stringify({ seeded: true }),
    );
  }

  console.log("[seed] done.");
  console.log(`[seed] sleep nights: 14, step days: 14, skill_runs: ${briefDecisions.length + commuteDecisions.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}
