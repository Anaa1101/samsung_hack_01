// Lightweight translation templates for AURA's messages.
// Numbers + event titles stay as-is (titles are user-controlled); only the wrapper text
// translates. For LLM-quality translation, route through Ollama with a "translate to X" prompt.

export type Lang = "en" | "hi" | "kn";

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  hi: "हिन्दी",
  kn: "ಕನ್ನಡ",
};

export const LANG_BCP47: Record<Lang, string> = {
  en: "en-US",
  hi: "hi-IN",
  kn: "kn-IN",
};

const COMPONENT_LABEL: Record<Lang, Record<string, string>> = {
  en: {
    sleep: "sleep",
    morning_activity: "morning activity",
    calendar_prep: "prep buffer",
    commute_buffer: "commute buffer",
    notifications: "notification load",
    focus_time: "focus block",
    meeting_load: "meeting load",
  },
  hi: {
    sleep: "नींद",
    morning_activity: "सुबह की गतिविधि",
    calendar_prep: "तैयारी समय",
    commute_buffer: "यात्रा का समय",
    notifications: "सूचनाएँ",
    focus_time: "एकाग्रता",
    meeting_load: "मीटिंग का बोझ",
  },
  kn: {
    sleep: "ನಿದ್ರೆ",
    morning_activity: "ಬೆಳಿಗ್ಗೆ ಚಟುವಟಿಕೆ",
    calendar_prep: "ಸಿದ್ಧತೆ ಸಮಯ",
    commute_buffer: "ಪ್ರಯಾಣ ಸಮಯ",
    notifications: "ಸೂಚನೆಗಳು",
    focus_time: "ಏಕಾಗ್ರತೆ",
    meeting_load: "ಸಭೆಗಳ ಭಾರ",
  },
};

export function componentLabel(lang: Lang, key: string): string {
  return COMPONENT_LABEL[lang]?.[key] ?? key.replace(/_/g, " ");
}

export type MorningBriefArgs = {
  score: number;
  weakest: string; // already translated component label
  weakestPct: number;
  nextTitle: string | null;
  nextMin: number | null;
};

export function morningBrief(lang: Lang, a: MorningBriefArgs): string {
  const nextLine = (en: string, hi: string, kn: string) => ({ en, hi, kn })[lang];
  if (a.nextTitle === null) {
    if (lang === "hi")
      return `सुप्रभात। आज की तैयारी ${a.score}/100. सबसे कमज़ोर: ${a.weakest} (${a.weakestPct}%). आज कोई मीटिंग नहीं।`;
    if (lang === "kn")
      return `ಶುಭೋದಯ. ಇಂದಿನ ಸಿದ್ಧತೆ ${a.score}/100. ದುರ್ಬಲ: ${a.weakest} (${a.weakestPct}%). ಇಂದು ಸಭೆಗಳಿಲ್ಲ.`;
    return `Morning. Day-readiness ${a.score}/100. Weakest: ${a.weakest} (${a.weakestPct}%). No meetings on deck.`;
  }
  if (lang === "hi")
    return `सुप्रभात। आज की तैयारी ${a.score}/100. सबसे कमज़ोर: ${a.weakest} (${a.weakestPct}%). अगला: ${a.nextTitle} ${a.nextMin} मिनट में।`;
  if (lang === "kn")
    return `ಶುಭೋದಯ. ಇಂದಿನ ಸಿದ್ಧತೆ ${a.score}/100. ದುರ್ಬಲ: ${a.weakest} (${a.weakestPct}%). ಮುಂದಿನದು: ${a.nextTitle} ${a.nextMin} ನಿಮಿಷದಲ್ಲಿ.`;
  return `Morning. Day-readiness ${a.score}/100. Weakest: ${a.weakest} (${a.weakestPct}%). Next: ${a.nextTitle} in ${a.nextMin} min.`;
}

export type CommuteArgs = {
  leaveInMin: number;
  reason: string;
  tempC: number;
};

const REASON_TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    "rain expected": "rain expected",
    "tight buffer": "tight buffer",
  },
  hi: {
    "rain expected": "बारिश की संभावना",
    "tight buffer": "समय कम है",
  },
  kn: {
    "rain expected": "ಮಳೆ ನಿರೀಕ್ಷೆ",
    "tight buffer": "ಸಮಯ ಕಡಿಮೆ",
  },
};

export function translateReason(lang: Lang, reason: string): string {
  const parts = reason.split(",").map((s) => s.trim());
  const translated = parts.map((p) => REASON_TRANSLATIONS[lang]?.[p] ?? p);
  return translated.join(lang === "en" ? ", " : ", ");
}

export function commuteNudge(lang: Lang, a: CommuteArgs): string {
  const r = translateReason(lang, a.reason);
  const t = `${Math.round(a.tempC)}°C`;
  if (a.leaveInMin <= 0) {
    if (lang === "hi") return `अभी निकलें। ${r}. ${t}.`;
    if (lang === "kn") return `ಈಗಲೇ ಹೊರಡಿ. ${r}. ${t}.`;
    return `Leave now. ${r}. ${t}.`;
  }
  if (lang === "hi") return `${a.leaveInMin} मिनट में निकलें। ${r}. ${t}.`;
  if (lang === "kn") return `${a.leaveInMin} ನಿಮಿಷದಲ್ಲಿ ಹೊರಡಿ. ${r}. ${t}.`;
  return `Leave in ${a.leaveInMin} min. ${r}. ${t}.`;
}

export function silentResponse(lang: Lang): string {
  if (lang === "hi") return "अभी कुछ ज़रूरी नहीं — मैं चुप रहूँगी।";
  if (lang === "kn") return "ಈಗ ಏನೂ ಪ್ರಮುಖವಲ್ಲ — ನಾನು ಸುಮ್ಮನಿರುತ್ತೇನೆ.";
  return "Nothing pressing right now — I'll stay quiet.";
}

export function isLang(x: unknown): x is Lang {
  return x === "en" || x === "hi" || x === "kn";
}
