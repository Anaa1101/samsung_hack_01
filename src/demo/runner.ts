// Demo runner — executes a DemoStep[] sequentially. Side effects are real:
// adds calendar rows, fires real skills through the real gate, real adversary,
// real audit log. The narration goes out via macOS `say` and is also stored
// in skill_runs so the dashboard's /api/last picks it up and the orb pulses.

import { db, recordEvent } from "../db.js";
import { speak } from "../gateway/voice.js";
import { append as auditAppend } from "../audit/log.js";
import { learnAndPersist } from "../twin/learn.js";
import * as morningBrief from "../skills/morning_brief/index.js";
import * as commuteGuardian from "../skills/commute_guardian/index.js";
import * as meetingReminder from "../skills/meeting_reminder/index.js";
import { DEMO_SCRIPT, type DemoStep } from "./script.js";

type Status = {
  running: boolean;
  step_index: number;
  total_steps: number;
  phase: string;
  highlight: string | null;
  highlight_label: string | null;
  started_at: string | null;
  finished_at: string | null;
};

const status: Status = {
  running: false,
  step_index: -1,
  total_steps: 0,
  phase: "idle",
  highlight: null,
  highlight_label: null,
  started_at: null,
  finished_at: null,
};

let abortRequested = false;

function recordNarration(text: string): number {
  const ts = new Date().toISOString();
  const ins = db
    .prepare("INSERT INTO skill_runs (ts, skill, accepted, dismissed, payload) VALUES (?, ?, ?, ?, ?)")
    .run(ts, "demo", null, null, JSON.stringify({ text, demo: true }));
  recordEvent("demo_narration", { text });
  return Number(ins.lastInsertRowid);
}

function clearEvents(matching?: string): number {
  const stmt = matching
    ? db.prepare("DELETE FROM calendar WHERE title LIKE ?")
    : db.prepare("DELETE FROM calendar");
  const r = matching ? stmt.run(`%${matching}%`) : stmt.run();
  return Number(r.changes);
}

function addEvent(title: string, minutesFromNow: number, durationMin = 30): void {
  const start = new Date(Date.now() + minutesFromNow * 60 * 1000);
  const end = new Date(start.getTime() + durationMin * 60 * 1000);
  db.prepare(
    "INSERT INTO calendar (start_ts, end_ts, title, location) VALUES (?, ?, ?, ?)",
  ).run(start.toISOString(), end.toISOString(), title, "Demo");
}

function lastSkillRunId(skill: string): number | null {
  const row = db
    .prepare("SELECT id FROM skill_runs WHERE skill = ? ORDER BY id DESC LIMIT 1")
    .get(skill) as { id: number } | undefined;
  return row?.id ?? null;
}

function applyFeedback(skill: string, action: "accept" | "dismiss"): void {
  const id = lastSkillRunId(skill);
  if (!id) return;
  db.prepare("UPDATE skill_runs SET accepted = ?, dismissed = ? WHERE id = ?").run(
    action === "accept" ? 1 : 0,
    action === "dismiss" ? 1 : 0,
    id,
  );
  auditAppend("user_feedback", { skill_run_id: id, action, source: "demo" });
  learnAndPersist();
}

async function runStep(step: DemoStep): Promise<void> {
  switch (step.kind) {
    case "say": {
      recordNarration(step.text);
      speak(step.text);
      // Estimated speech duration: ~75 ms/char + a small base + the configured pause.
      const speechMs = Math.min(12000, 800 + step.text.length * 75);
      await sleep(speechMs + (step.pauseMs ?? 0));
      break;
    }
    case "wait":
      await sleep(step.ms);
      break;
    case "add_event":
      addEvent(step.title, step.minutesFromNow, step.durationMin ?? 30);
      auditAppend("demo_action", { kind: "add_event", title: step.title });
      break;
    case "clear_events":
      clearEvents(step.matching);
      auditAppend("demo_action", { kind: "clear_events", matching: step.matching });
      break;
    case "trigger": {
      auditAppend("demo_action", { kind: "trigger", skill: step.skill });
      const runner =
        step.skill === "morning_brief"
          ? morningBrief.run
          : step.skill === "commute_guardian"
            ? commuteGuardian.run
            : meetingReminder.run;
      await runner({ dry_run: false });
      break;
    }
    case "feedback":
      applyFeedback(step.lastSkill, step.action);
      break;
    case "highlight":
      status.highlight = step.section;
      status.highlight_label = step.label ?? null;
      break;
    case "set_phase":
      status.phase = step.phase;
      status.highlight = null;
      status.highlight_label = null;
      break;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startDemo(): Promise<void> {
  if (status.running) return;
  abortRequested = false;
  status.running = true;
  status.step_index = -1;
  status.total_steps = DEMO_SCRIPT.length;
  status.phase = "starting";
  status.highlight = null;
  status.highlight_label = null;
  status.started_at = new Date().toISOString();
  status.finished_at = null;
  auditAppend("demo_start", { steps: DEMO_SCRIPT.length });

  for (let i = 0; i < DEMO_SCRIPT.length; i++) {
    if (abortRequested) {
      auditAppend("demo_abort", { at_step: i });
      break;
    }
    status.step_index = i;
    try {
      await runStep(DEMO_SCRIPT[i]);
    } catch (e) {
      auditAppend("demo_error", { at_step: i, error: (e as Error).message });
      console.error("[demo] step failed:", e);
    }
  }

  status.running = false;
  status.finished_at = new Date().toISOString();
  status.phase = "done";
  auditAppend("demo_end", {});
}

export function stopDemo(): void {
  abortRequested = true;
}

export function getDemoStatus(): Status {
  return { ...status };
}
