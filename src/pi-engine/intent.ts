// Intent router — small keyword/regex classifier. Turns a free-text transcript
// into a structured action. No LLM needed for the MVP. Extend by adding handlers.

import { db, isShuttingDown, localDayBounds, recordEvent } from "../db.js";
import { computeScore } from "../score/compute.js";
import { getWeather } from "../gateway/weather.js";
import {
  openApp,
  openFile,
  openUrl,
  webSearch,
  SHORTCUTS,
  type ActionResult,
} from "../gateway/actions.js";
import {
  setVolume,
  adjustVolume,
  muteVolume,
  unmuteVolume,
  lockScreen,
  takeScreenshot,
} from "../gateway/system.js";
import { wikiSummary, defineWord, tellJoke } from "../gateway/lookup.js";
import { speakWithRetry } from "../gateway/voice.js";
import { narrate } from "../gateway/ollama.js";
import { config } from "../config.js";
import { append as auditAppend } from "../audit/log.js";
import * as morningBrief from "../skills/morning_brief/index.js";
import * as commuteGuardian from "../skills/commute_guardian/index.js";
import { type Lang } from "../i18n.js";

export type IntentResult = {
  intent: string;
  reply: string;
  action?: ActionResult;
  side_effect?: Record<string, unknown>;
};

function strip(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(hey |ok |okay |hi |hello )?aura[,\s]*/i, "")
    .replace(/[.?!]$/g, "")
    .trim();
}
function clean(s: string): string {
  return s.replace(/(can you|could you|please|would you|i want to|i'd like to)\s+/g, "").trim();
}
function findShortcut(text: string): ActionResult | null {
  for (const key of Object.keys(SHORTCUTS).sort((a, b) => b.length - a.length)) {
    if (text.includes(key)) return SHORTCUTS[key]();
  }
  return null;
}
function ensureQuietBlock(minutes: number, reason: string): void {
  const start = new Date();
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  db.prepare("INSERT INTO quiet_blocks (start_ts, end_ts, reason) VALUES (?, ?, ?)").run(
    start.toISOString(),
    end.toISOString(),
    reason,
  );
}
function pickReply(lang: Lang, en: string, hi: string, kn: string): string {
  return lang === "hi" ? hi : lang === "kn" ? kn : en;
}

// ---- Safe math evaluator (digits + ops only). Never use eval on raw input.
function safeEvalMath(expr: string): number | null {
  const cleaned = expr
    .replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "-")
    .replace(/\btimes\b|\bx\b|\bmultiplied by\b/gi, "*")
    .replace(/\bdivided by\b|\bover\b/gi, "/")
    .replace(/[^0-9+\-*/().\s]/g, "");
  if (!/[0-9]/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict";return (${cleaned})`)();
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ---- Timer scheduler (in-process)
function scheduleTimer(label: string, minutes: number): void {
  const end = new Date(Date.now() + minutes * 60 * 1000);
  const res = db
    .prepare("INSERT INTO timers (label, end_ts, fired) VALUES (?, ?, 0)")
    .run(
    label,
    end.toISOString(),
  );
  const timerId = Number(res.lastInsertRowid);
  setTimeout(async () => {
    if (isShuttingDown()) {
      auditAppend("timer_deferred", { label, minutes, reason: "shutdown" });
      return;
    }
    const message = `Timer up: ${label}.`;
    const spoken = await speakWithRetry(message);
    db.prepare("UPDATE timers SET fired = 1 WHERE id = ?").run(timerId);
    recordEvent("timer_fired", { label, minutes, spoken: spoken.spoken, attempts: spoken.attempts });
    auditAppend("timer_fired", { label, minutes, spoken: spoken.spoken, attempts: spoken.attempts });
  }, minutes * 60 * 1000);
}

export async function route(transcriptRaw: string, lang: Lang = "en"): Promise<IntentResult> {
  const transcript = clean(strip(transcriptRaw));
  const log = (r: IntentResult): IntentResult => {
    auditAppend("intent", { transcript: transcriptRaw, ...r });
    return r;
  };

  // ---- DND ----
  const dnd = transcript.match(
    /(don'?t disturb|do not disturb|mute|silence|leave me alone|quiet)\s*(me)?\s*(for)?\s*(\d+)?\s*(min|minute|minutes|hour|hours|hr|hrs)?/i,
  );
  if (dnd) {
    const num = Number(dnd[4] ?? 30);
    const unit = (dnd[5] ?? "min").toLowerCase();
    const minutes = unit.startsWith("hour") || unit.startsWith("hr") ? num * 60 : num;
    ensureQuietBlock(minutes, transcriptRaw);
    return log({
      intent: "dnd",
      reply: pickReply(
        lang,
        `Muted for ${minutes} minutes.`,
        `${minutes} मिनट तक चुप रहूँगी।`,
        `${minutes} ನಿಮಿಷ ಸುಮ್ಮನಿರುತ್ತೇನೆ.`,
      ),
    });
  }

  // ---- Time / date ----
  if (/^(time|what time|whats the time|what'?s the time)/.test(transcript)) {
    const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return log({ intent: "time", reply: pickReply(lang, `It's ${t}.`, `अभी ${t} बजे हैं।`, `ಈಗ ${t}.`) });
  }
  if (/^(date|what date|today|what day|whats the date|what'?s the date)/.test(transcript)) {
    const d = new Date().toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return log({ intent: "date", reply: pickReply(lang, `Today is ${d}.`, `आज ${d} है।`, `ಇಂದು ${d}.`) });
  }

  // ---- Math ----
  const math = transcript.match(/^(what'?s |whats |calculate |compute |solve )?(.+)/);
  if (math && /[\d+\-*/().]|plus|minus|times|divided/.test(transcript) && /[0-9]/.test(transcript)) {
    const result = safeEvalMath(math[2] ?? transcript);
    if (result !== null) {
      return log({
        intent: "math",
        reply: pickReply(lang, `${result}.`, `उत्तर ${result} है।`, `ಉತ್ತರ ${result}.`),
        side_effect: { result },
      });
    }
  }

  // ---- Notes ----
  const noteMatch = transcript.match(/^(note|remember|save note|take a note)[:\s]+(.+)/);
  if (noteMatch) {
    const body = noteMatch[2];
    db.prepare("INSERT INTO notes (ts, body) VALUES (?, ?)").run(new Date().toISOString(), body);
    return log({
      intent: "note_save",
      reply: pickReply(lang, `Noted: ${body}.`, `लिख लिया: ${body}।`, `ಬರೆದುಕೊಂಡೆ: ${body}.`),
    });
  }
  if (/^(what are my notes|read notes|list notes|my notes)/.test(transcript)) {
    const rows = db
      .prepare("SELECT body FROM notes ORDER BY id DESC LIMIT 5")
      .all() as Array<{ body: string }>;
    if (rows.length === 0) {
      return log({
        intent: "note_list",
        reply: pickReply(lang, "No notes yet.", "अभी कोई नोट नहीं।", "ಯಾವುದೇ ಟಿಪ್ಪಣಿಗಳಿಲ್ಲ."),
      });
    }
    const list = rows.map((r, i) => `${i + 1}. ${r.body}`).join(". ");
    return log({ intent: "note_list", reply: list });
  }

  // ---- Timer ----
  const timer = transcript.match(/(set|start)\s+(a\s+)?(\d+)\s*(min|minute|minutes|sec|second|seconds)\s*(timer)?(\s+for\s+(.+))?/);
  if (timer) {
    const n = Number(timer[3]);
    const unit = (timer[4] ?? "min").toLowerCase();
    const minutes = unit.startsWith("sec") ? n / 60 : n;
    const label = (timer[7] ?? `timer`).trim();
    scheduleTimer(label, minutes);
    return log({
      intent: "timer",
      reply: pickReply(
        lang,
        `Timer set for ${n} ${unit}.`,
        `${n} ${unit} का टाइमर सेट किया।`,
        `${n} ${unit} ಟೈಮರ್ ಸೆಟ್ ಮಾಡಿದೆ.`,
      ),
    });
  }

  // ---- Volume ----
  if (/(volume up|louder|turn it up)/.test(transcript)) {
    const r = adjustVolume(15);
    return log({ intent: "volume_up", reply: `Volume ${r.pct}.` });
  }
  if (/(volume down|quieter|turn it down)/.test(transcript)) {
    const r = adjustVolume(-15);
    return log({ intent: "volume_down", reply: `Volume ${r.pct}.` });
  }
  if (/(mute|silence the speakers)/.test(transcript)) {
    muteVolume();
    return log({ intent: "mute", reply: pickReply(lang, "Muted.", "म्यूट कर दिया।", "ಮ್ಯೂಟ್ ಮಾಡಿದೆ.") });
  }
  if (/(unmute|turn sound back on)/.test(transcript)) {
    unmuteVolume();
    return log({ intent: "unmute", reply: pickReply(lang, "Unmuted.", "अनम्यूट कर दिया।", "ಅನ್‌ಮ್ಯೂಟ್ ಮಾಡಿದೆ.") });
  }
  const setVol = transcript.match(/(set\s+)?volume\s+(?:to\s+)?(\d+)/);
  if (setVol) {
    const r = setVolume(Number(setVol[2]));
    return log({ intent: "volume_set", reply: `Volume set to ${r.pct}.` });
  }

  // ---- Lock screen / screenshot ----
  if (/lock (the )?screen|lock my mac|lock laptop/.test(transcript)) {
    lockScreen();
    return log({ intent: "lock", reply: pickReply(lang, "Locking.", "लॉक कर रही हूँ।", "ಲಾಕ್ ಮಾಡುತ್ತಿದ್ದೇನೆ.") });
  }
  if (/(take|grab) a screenshot|screencap/.test(transcript)) {
    const r = takeScreenshot();
    return log({
      intent: "screenshot",
      reply: r.ok ? `Screenshot tool open. Saved to Desktop.` : "Couldn't take a screenshot.",
    });
  }

  // ---- Wikipedia ----
  const wiki = transcript.match(
    /^(tell me about|wikipedia|wiki|who is|what is|whats|what'?s|who'?s)\s+(.+)/,
  );
  if (wiki) {
    const topic = wiki[2];
    const r = await wikiSummary(topic);
    if (r.ok) return log({ intent: "wiki", reply: r.text, side_effect: { url: r.url } });
    // fall through — let lower handlers try, else search
  }

  // ---- Define ----
  const defmatch = transcript.match(/^(define|what does (.+) mean|definition of)\s+(.+)/);
  if (defmatch) {
    const word = (defmatch[2] ?? defmatch[3]).split(/\s+/)[0];
    const r = await defineWord(word);
    return log({ intent: "define", reply: r.text });
  }

  // ---- Joke ----
  if (/(tell me a joke|make me laugh|joke)/.test(transcript)) {
    const r = await tellJoke();
    return log({ intent: "joke", reply: r.text });
  }

  // ---- Open shortcuts ----
  const shortcut = findShortcut(transcript);
  if (shortcut) return log({ intent: "shortcut", reply: shortcut.message, action: shortcut });

  // ---- Open URL ----
  const openUrlMatch = transcript.match(
    /^(open|pull up|launch|go to|visit)\s+(https?:\/\/\S+|[\w-]+\.[\w./?#=&-]+)/,
  );
  if (openUrlMatch) {
    const url = openUrlMatch[2].replace(/\s+dot\s+/g, ".").replace(/\s+slash\s+/g, "/");
    const action = openUrl(url);
    return log({ intent: "open_url", reply: action.message, action });
  }

  // ---- Open app ----
  const openAppMatch = transcript.match(
    /^(open|launch|start)\s+(spotify|notion|slack|chrome|safari|notes|calendar|mail|messages|finder|terminal|vs code|vscode|visual studio code|cursor|zoom|arc|obsidian|figma)\b/,
  );
  if (openAppMatch) {
    const action = openApp(openAppMatch[2]);
    return log({ intent: "open_app", reply: action.message, action });
  }

  // ---- Search ----
  const search = transcript.match(
    /^(search|google|look up|find|when is|when'?s|where is|where'?s)\s+(.+)/,
  );
  if (search) {
    const q = search[2];
    const action = webSearch(q);
    return log({ intent: "search", reply: action.message, action });
  }

  // ---- Status ----
  if (/(score|readiness|how am i|how'?s my day)/.test(transcript)) {
    const score = computeScore();
    return log({
      intent: "score",
      reply: pickReply(
        lang,
        `Your day-readiness is ${score.total} out of 100.`,
        `आपकी आज की तैयारी ${score.total} में से 100 है।`,
        `ಇಂದಿನ ಸಿದ್ಧತೆ ${score.total} ಶೇಕಡಾ.`,
      ),
      side_effect: { score: score.total },
    });
  }

  if (/(next meeting|next event|whats next|what'?s next|agenda)/.test(transcript)) {
    const next = db
      .prepare(
        "SELECT title, start_ts FROM calendar WHERE start_ts > datetime('now') ORDER BY start_ts ASC LIMIT 1",
      )
      .get() as { title: string; start_ts: string } | undefined;
    if (!next) {
      return log({
        intent: "next_event",
        reply: pickReply(lang, "Nothing else today.", "आज कोई और मीटिंग नहीं।", "ಇಂದು ಬೇರೆ ಸಭೆಗಳಿಲ್ಲ."),
      });
    }
    const minUntil = Math.round((new Date(next.start_ts).getTime() - Date.now()) / 60000);
    return log({
      intent: "next_event",
      reply: pickReply(
        lang,
        `Next: ${next.title} in ${minUntil} minutes.`,
        `अगला: ${next.title}, ${minUntil} मिनट में।`,
        `ಮುಂದಿನದು: ${next.title}, ${minUntil} ನಿಮಿಷದಲ್ಲಿ.`,
      ),
    });
  }

  if (/(meetings today|all my meetings|today'?s schedule)/.test(transcript)) {
    const now = new Date();
    const todayBounds = localDayBounds(now);
    const rows = db
      .prepare(
        "SELECT title, start_ts FROM calendar WHERE start_ts >= ? AND start_ts <= ? ORDER BY start_ts ASC",
      )
      .all(todayBounds.start, todayBounds.end) as Array<{ title: string; start_ts: string }>;
    if (!rows.length) {
      return log({ intent: "meetings_today", reply: pickReply(lang, "No meetings today.", "आज कोई मीटिंग नहीं।", "ಇಂದು ಸಭೆಗಳಿಲ್ಲ.") });
    }
    const list = rows
      .map((r) => `${new Date(r.start_ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${r.title}`)
      .join(", ");
    return log({ intent: "meetings_today", reply: list });
  }

  if (/(weather|rain|temperature|hot|cold)/.test(transcript)) {
    const w = await getWeather();
    return log({
      intent: "weather",
      reply: pickReply(
        lang,
        `It's ${Math.round(w.temp_c)} degrees, ${w.is_raining_soon ? "rain expected soon" : "no rain expected"}.`,
        `तापमान ${Math.round(w.temp_c)} डिग्री, ${w.is_raining_soon ? "बारिश की संभावना है" : "बारिश नहीं"}।`,
        `${Math.round(w.temp_c)} ಡಿಗ್ರಿ, ${w.is_raining_soon ? "ಮಳೆ ಬರಬಹುದು" : "ಮಳೆ ಇಲ್ಲ"}.`,
      ),
      side_effect: { weather: w },
    });
  }

  // ---- Trigger skills on demand ----
  if (/(brief|morning brief|tell me about my day|how does my day look)/.test(transcript)) {
    const r = await morningBrief.run({ dry_run: false, lang });
    return log({
      intent: "run_morning_brief",
      reply: r.message?.text ?? "Nothing to report.",
      side_effect: { decision: r.decision, score: r.score.total },
    });
  }
  if (/(commute|should i leave|when do i leave|leaving)/.test(transcript)) {
    const r = await commuteGuardian.run({ dry_run: false, lang });
    return log({
      intent: "run_commute",
      reply: r.message?.text ?? "Nothing to flag for the commute right now.",
      side_effect: { decision: r.decision, recommendation: r.recommendation },
    });
  }

  // ---- Capabilities / help ----
  if (/(what can you do|what do you do|your capabilities|capabilities|^help$|how can you help|what are you good at)/.test(transcript)) {
    return log({
      intent: "capabilities",
      reply: pickReply(
        lang,
        "Quite a bit. I brief your day, remind you about meetings, set timers, take notes, search Wikipedia, define words, tell jokes, control your Mac volume, lock your screen, switch to Hindi or Kannada, and stay quiet when you ask. The interesting part: I decide when to speak first instead of waiting for you. Want me to demo myself? Just say 'demo yourself'.",
        "बहुत कुछ। मैं आपका दिन ब्रीफ़ कर सकती हूँ, मीटिंग याद दिला सकती हूँ, टाइमर सेट कर सकती हूँ, नोट्स ले सकती हूँ, विकिपीडिया खोज सकती हूँ, और चुप भी रह सकती हूँ। 'demo yourself' कहें तो मैं ख़ुद डेमो करूँगी।",
        "ಬಹಳಷ್ಟು. ನಾನು ನಿಮ್ಮ ದಿನವನ್ನು ಬ್ರೀಫ್ ಮಾಡಬಲ್ಲೆ, ಸಭೆಗಳನ್ನು ನೆನಪಿಸಬಲ್ಲೆ, ಟೈಮರ್ ಸೆಟ್ ಮಾಡಬಲ್ಲೆ, ಟಿಪ್ಪಣಿಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಬಲ್ಲೆ, ಮತ್ತು ಸುಮ್ಮನಿರಲೂ ಬಲ್ಲೆ. 'demo yourself' ಎಂದು ಹೇಳಿ.",
      ),
    });
  }

  // ---- Identity ----
  if (/(who are you|what'?s your name|whats your name|tell me about yourself|what are you)/.test(transcript)) {
    return log({
      intent: "identity",
      reply: pickReply(
        lang,
        "I'm AURA. A proactive personal agent. Other assistants wait for you to ask — I watch your day and decide when staying silent is worse than speaking. I run on your laptop, configured by four small files, with every decision in an audit log.",
        "मैं AURA हूँ। एक प्रोएक्टिव असिस्टेंट। बाक़ी असिस्टेंट आपके पूछने का इंतज़ार करते हैं — मैं ख़ुद देखती हूँ और तय करती हूँ कि कब बोलना है।",
        "ನಾನು AURA. ಒಂದು ಪ್ರೊಆಕ್ಟಿವ್ ಸಹಾಯಕಿ. ಇತರ ಸಹಾಯಕರು ನೀವು ಕೇಳುವವರೆಗೆ ಕಾಯುತ್ತಾರೆ — ನಾನು ನಿಮ್ಮ ದಿನವನ್ನು ಗಮನಿಸಿ ಯಾವಾಗ ಮಾತನಾಡಬೇಕೆಂದು ನಿರ್ಧರಿಸುತ್ತೇನೆ.",
      ),
    });
  }

  // ---- Trigger auto-demo by voice ----
  if (/(demo yourself|show me what you can do|run the demo|start the demo|pitch yourself)/.test(transcript)) {
    // Lazy import so we don't pull demo runner into the hot path.
    const mod = await import("../demo/runner.js");
    if (!mod.getDemoStatus().running) void mod.startDemo();
    return log({
      intent: "start_demo",
      reply: pickReply(lang, "Watch.", "देखिए।", "ನೋಡಿ."),
    });
  }

  // ---- Are you there? ----
  if (/(are you there|are you listening|you alive|you up|you with me)/.test(transcript)) {
    return log({
      intent: "presence",
      reply: pickReply(lang, "Right here.", "हाँ, यहीं हूँ।", "ಇಲ್ಲಿಯೇ ಇದ್ದೇನೆ."),
    });
  }

  // ---- Greetings ----
  if (/^(hi|hello|hey|sup|yo)$/.test(transcript)) {
    return log({
      intent: "greeting",
      reply: pickReply(
        lang,
        "I'm here. What do you need?",
        "मैं यहाँ हूँ। क्या चाहिए?",
        "ನಾನು ಇಲ್ಲಿದ್ದೇನೆ. ಏನು ಬೇಕು?",
      ),
    });
  }
  if (/(thanks|thank you|good job|nice)/.test(transcript)) {
    return log({
      intent: "thanks",
      reply: pickReply(lang, "Anytime.", "कभी भी।", "ಯಾವಾಗ ಬೇಕಾದರೂ."),
    });
  }

  // ---- Unit conversion (offline) ----
  const conv = transcript.match(
    /(?:how many|convert)?\s*(\d+(?:\.\d+)?)\s*(km|miles?|kg|lbs?|pounds?|c|f|celsius|fahrenheit|cm|inches?|in|m|ft|feet|kmh|mph)\s*(?:in|to|=)\s*(km|miles?|kg|lbs?|pounds?|c|f|celsius|fahrenheit|cm|inches?|in|m|ft|feet|kmh|mph)/,
  );
  if (conv) {
    const n = Number(conv[1]);
    const from = conv[2].toLowerCase().replace(/s$/, "");
    const to = conv[3].toLowerCase().replace(/s$/, "");
    const result = convertUnits(n, from, to);
    if (result !== null) {
      return log({
        intent: "convert",
        reply: pickReply(
          lang,
          `${n} ${conv[2]} is ${result.toFixed(2)} ${conv[3]}.`,
          `${n} ${conv[2]} = ${result.toFixed(2)} ${conv[3]}.`,
          `${n} ${conv[2]} = ${result.toFixed(2)} ${conv[3]}.`,
        ),
      });
    }
  }

  // ---- Coin / dice / random (offline, fun) ----
  if (/(flip a coin|coin flip|toss a coin)/.test(transcript)) {
    const r = Math.random() < 0.5 ? "heads" : "tails";
    return log({
      intent: "coin",
      reply: pickReply(lang, r === "heads" ? "Heads." : "Tails.", r === "heads" ? "हेड्स।" : "टेल्स।", r === "heads" ? "ಹೆಡ್ಸ್." : "ಟೈಲ್ಸ್."),
    });
  }
  if (/(roll a (die|dice)|throw a die|dice)/.test(transcript)) {
    const r = Math.floor(Math.random() * 6) + 1;
    return log({ intent: "dice", reply: `${r}.` });
  }
  const rand = transcript.match(/random number (?:between |from )?(\d+)\s*(?:and|to)\s*(\d+)/);
  if (rand) {
    const lo = Number(rand[1]);
    const hi = Number(rand[2]);
    const n = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    return log({ intent: "random", reply: `${n}.` });
  }

  // ---- Spell ----
  const spell = transcript.match(/(?:how do you )?spell\s+(\w+)/);
  if (spell) {
    const w = spell[1];
    return log({ intent: "spell", reply: w.toUpperCase().split("").join(" ") + "." });
  }

  // ---- Hard fallback: try Ollama first (acts like Jarvis), then web search ----
  if (config.ollama.url) {
    const langInstr =
      lang === "hi"
        ? "Reply in Hindi (Devanagari)."
        : lang === "kn"
          ? "Reply in Kannada (ಕನ್ನಡ)."
          : "Reply in English.";
    const r = await narrate({
      system: `You are AURA, a helpful conversational assistant running locally on the user's laptop. ${langInstr} Be concise — under 280 characters. Answer directly. If you genuinely don't know, say so honestly. Never apologize, never say "as an AI".`,
      user: transcriptRaw,
      fallback: "",
    });
    if (r.text && r.text.length > 4 && r.source === "ollama") {
      return log({ intent: "llm_answer", reply: r.text });
    }
  }

  // ---- Final fallback: web search + hint about Ollama ----
  const action = webSearch(transcriptRaw);
  const hint = config.ollama.url
    ? ""
    : pickReply(
        lang,
        " Tip: install Ollama and I can answer this offline.",
        " इंस्टॉल करें Ollama, मैं ऑफ़लाइन जवाब दूँगी।",
        " Ollama ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ — ನಾನು ಆಫ್‌ಲೈನ್ ಉತ್ತರಿಸುತ್ತೇನೆ.",
      );
  return log({
    intent: "fallback_search",
    reply:
      pickReply(
        lang,
        `Let me search that for you.`,
        `गूगल पर देखती हूँ।`,
        `ಗೂಗಲ್‌ನಲ್ಲಿ ಹುಡುಕುತ್ತೇನೆ.`,
      ) + hint,
    action,
  });
}

// ---- Unit converter (small, offline) ----
function convertUnits(n: number, from: string, to: string): number | null {
  const norm = (u: string): string => {
    if (["mile"].includes(u)) return "mile";
    if (["lb", "pound"].includes(u)) return "lb";
    if (["celsius"].includes(u)) return "c";
    if (["fahrenheit"].includes(u)) return "f";
    if (["inche", "in"].includes(u)) return "in";
    if (["foot", "ft", "feet"].includes(u)) return "ft";
    return u;
  };
  const f = norm(from);
  const t = norm(to);
  // Length: km, mile, m, cm, in, ft
  const toMeters: Record<string, number> = {
    km: 1000, mile: 1609.344, m: 1, cm: 0.01, in: 0.0254, ft: 0.3048,
  };
  if (toMeters[f] && toMeters[t]) return (n * toMeters[f]) / toMeters[t];
  // Mass
  const toKg: Record<string, number> = { kg: 1, lb: 0.453592 };
  if (toKg[f] && toKg[t]) return (n * toKg[f]) / toKg[t];
  // Speed
  if ((f === "kmh" && t === "mph")) return n * 0.621371;
  if (f === "mph" && t === "kmh") return n / 0.621371;
  // Temperature
  if (f === "c" && t === "f") return (n * 9) / 5 + 32;
  if (f === "f" && t === "c") return ((n - 32) * 5) / 9;
  return null;
}
