import { runSkill, type SkillBaseResult } from "../_lib.js";
import { db } from "../../db.js";
import type { Lang } from "../../i18n.js";

function todaySummary(now: Date) {
  const date = now.toISOString().slice(0, 10);
  const meetings = db
    .prepare("SELECT COUNT(*) AS c FROM calendar WHERE date(start_ts) = ?")
    .get(date) as { c: number } | undefined;
  const steps = db
    .prepare("SELECT COALESCE(SUM(count), 0) AS c FROM steps WHERE date = ?")
    .get(date) as { c: number } | undefined;
  const notifs = db
    .prepare("SELECT COUNT(*) AS c FROM skill_runs WHERE date(ts) = ?")
    .get(date) as { c: number } | undefined;
  return {
    meetings: meetings?.c ?? 0,
    steps: steps?.c ?? 0,
    notifs: notifs?.c ?? 0,
  };
}

export async function run(opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {}): Promise<SkillBaseResult> {
  const now = opts.now ?? new Date();
  return runSkill(
    {
      skill: "eod_wrap",
      importance: "normal",
      buildText: ({ lang }) => {
        const s = todaySummary(now);
        if (lang === "hi")
          return `आज ${s.meetings} मीटिंग, ${s.steps} कदम, ${s.notifs} सूचनाएँ। अच्छा दिन था।`;
        if (lang === "kn")
          return `ಇಂದು ${s.meetings} ಸಭೆಗಳು, ${s.steps} ಹೆಜ್ಜೆಗಳು, ${s.notifs} ಸೂಚನೆಗಳು. ಒಳ್ಳೆಯ ದಿನ.`;
        return `Day wrap: ${s.meetings} meetings, ${s.steps.toLocaleString()} steps, ${s.notifs} pings. Good day.`;
      },
    },
    opts,
  );
}
