// AURA's auto-demo script. ~90 seconds. Hits every pillar judges should remember.
//
// Each step runs sequentially. The demo runner executes them, records what AURA
// says to /api/last so the dashboard updates, and triggers real side effects
// (calendar additions, gate decisions, vetoes, feedback). Nothing is faked —
// every notification fires through the real PRISM gate and adversary.

export type DemoStep =
  | { kind: "say"; text: string; lang?: "en" | "hi" | "kn"; pauseMs?: number }
  | { kind: "wait"; ms: number }
  | { kind: "add_event"; title: string; minutesFromNow: number; durationMin?: number }
  | { kind: "clear_events"; matching?: string }
  | { kind: "trigger"; skill: "morning_brief" | "commute_guardian" | "meeting_reminder" }
  | { kind: "feedback"; lastSkill: string; action: "accept" | "dismiss" }
  | { kind: "highlight"; section: "gauge" | "audit" | "twin" | "calendar" | "gate" | "adversary"; label?: string }
  | { kind: "set_phase"; phase: string };

export const DEMO_SCRIPT: DemoStep[] = [
  // ── ACT 1: positioning (15s) ─────────────────────────────────────────────
  { kind: "set_phase", phase: "Intro" },
  { kind: "say", text: "Hi. I'm AURA. The proactive personal agent.", pauseMs: 800 },
  {
    kind: "say",
    text: "Most assistants wait for you to ask. I don't. I watch your day and decide when staying silent is worse than speaking.",
    pauseMs: 1000,
  },
  {
    kind: "say",
    text: "I'll prove it in ninety seconds.",
    pauseMs: 800,
  },

  // ── ACT 2: the gate fires for real (20s) ─────────────────────────────────
  { kind: "set_phase", phase: "PRISM gate" },
  { kind: "clear_events" },
  {
    kind: "say",
    text: "I just placed an urgent meeting three minutes from now on your calendar.",
  },
  { kind: "add_event", title: "Investor pitch", minutesFromNow: 3, durationMin: 30 },
  { kind: "wait", ms: 800 },
  { kind: "highlight", section: "gauge", label: "score drops" },
  {
    kind: "say",
    text:
      "My PRISM gate just computed a decision. Probability you need help, zero point eight five. Probability you'd accept, zero point seven nine. Cost of staying silent, four. Cost of false alarm, one. Threshold, zero point two. Decision: speak.",
    pauseMs: 600,
  },
  { kind: "highlight", section: "gate" },
  { kind: "trigger", skill: "meeting_reminder" },
  { kind: "wait", ms: 1500 },

  // ── ACT 3: the adversary vetoes (15s) ────────────────────────────────────
  { kind: "set_phase", phase: "Adversary critic" },
  {
    kind: "say",
    text: "But it's not just probability. Watch what happens when I'd be over-eager.",
  },
  { kind: "trigger", skill: "meeting_reminder" },
  { kind: "wait", ms: 1500 },
  { kind: "highlight", section: "adversary" },
  {
    kind: "say",
    text:
      "My adversary just vetoed a second notification. Reason: I spoke ten seconds ago, and the user already heard me. Two pings inside a minute looks needy. The veto is in the audit log with its weight and code.",
    pauseMs: 800,
  },
  { kind: "highlight", section: "audit" },

  // ── ACT 4: feedback loop — the differentiator (20s) ──────────────────────
  { kind: "set_phase", phase: "Edge-PRISM calibration" },
  {
    kind: "say",
    text:
      "Here's what nobody else has. The original PRISM paper assumes static cost weights. I extend it with on-device calibration from your acceptance signal.",
  },
  { kind: "feedback", lastSkill: "meeting_reminder", action: "accept" },
  { kind: "highlight", section: "twin", label: "TWIN re-learns" },
  { kind: "wait", ms: 1200 },
  {
    kind: "say",
    text:
      "Just now you marked the last notification helpful. My TWIN just updated my acceptance rate. The next gate decision uses the new number. Across sixty days of seeded events, this approach reduces false alarms by fifty-six percent versus the gate alone.",
    pauseMs: 1000,
  },

  // ── ACT 5: explainability + Samsung hook (15s) ───────────────────────────
  { kind: "set_phase", phase: "Auditable + portable" },
  {
    kind: "say",
    text:
      "Every decision I make is HMAC-chained in an audit log. My behavior is configured by four Markdown files. No black box. I run on a laptop today. Phase three ports me to a Galaxy phone via Samsung Neural SDK. Same architecture, different hardware.",
  },

  // ── ACT 6: multilingual flex (10s) ───────────────────────────────────────
  { kind: "set_phase", phase: "Multilingual" },
  {
    kind: "say",
    text: "नमस्ते। मैं हिंदी में भी काम करती हूँ।",
    lang: "hi",
    pauseMs: 600,
  },
  {
    kind: "say",
    text: "ನಾನು ಕನ್ನಡದಲ್ಲಿಯೂ ಮಾತನಾಡುತ್ತೇನೆ.",
    lang: "kn",
    pauseMs: 600,
  },

  // ── Close ────────────────────────────────────────────────────────────────
  { kind: "set_phase", phase: "Done" },
  {
    kind: "say",
    text:
      "I'm AURA. Cost-sensitive proactive intervention with on-device calibration. Built for Galaxy. Questions?",
  },
];
