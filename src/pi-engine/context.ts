import { db, localDayBounds } from "../db.js";
import { computeScore } from "../score/compute.js";
import fs from "node:fs";
import path from "node:path";

export type SystemState = {
  userName: string;
  time: string;
  score: number;
  steps: number;
  nextMeeting?: { title: string; time: string };
  recentNotes: string[];
  hrvStress: number;
  soul: string;
  twin: string;
};

export function getSystemState(): SystemState {
  const now = new Date();
  const today = localDayBounds(now);
  
  // Read SOUL and TWIN (Pruned for speed in production)
  const soul = fs.readFileSync(path.resolve("SOUL.md"), "utf8").slice(0, 500);
  const twin = fs.readFileSync(path.resolve("TWIN.md"), "utf8").slice(0, 500);
  
  // Steps
  const stepRow = db.prepare("SELECT SUM(count) as total FROM steps WHERE date = ?")
    .get(today.start.split("T")[0]) as { total: number } | undefined;
    
  // Next Meeting
  const next = db.prepare(
    "SELECT title, start_ts FROM calendar WHERE start_ts > datetime('now') ORDER BY start_ts ASC LIMIT 1"
  ).get() as { title: string; start_ts: string } | undefined;

  // Recent Notes
  const notes = db.prepare("SELECT body FROM notes ORDER BY id DESC LIMIT 3")
    .all() as Array<{ body: string }>;

  // Score
  const score = computeScore();

  return {
    userName: "User", // Can be customized if setting exists
    time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    score: score.total,
    steps: stepRow?.total || 0,
    nextMeeting: next ? { 
      title: next.title, 
      time: new Date(next.start_ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) 
    } : undefined,
    recentNotes: notes.map(n => n.body),
    hrvStress: 0.85, 
    soul,
    twin,
  };
}

export function formatContextForLLM(state: SystemState): string {
  return `
--- MY IDENTITY (SOUL.md) ---
${state.soul}

--- WHAT I KNOW ABOUT USER (TWIN.md) ---
${state.twin}

--- CURRENT SNAPSHOT ---
Time: ${state.time}
User Readiness: ${state.score}/100
Steps: ${state.steps}
${state.nextMeeting ? `Next Meeting: ${state.nextMeeting.title} at ${state.nextMeeting.time}` : "No more meetings today."}
Stress (HRV): ${state.hrvStress > 0.7 ? "High" : "Normal"}
`.trim();
}
