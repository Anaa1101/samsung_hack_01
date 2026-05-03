import { runSkill, type SkillBaseResult } from "../_lib.js";
import type { Lang } from "../../i18n.js";

const TEXT: Record<Lang, string> = {
  en: "Wind-down time. Dim the lights, close the laptop, breathe.",
  hi: "आराम का समय। लाइट कम करें, लैपटॉप बंद करें, गहरी साँस लें।",
  kn: "ವಿಶ್ರಾಂತಿಯ ಸಮಯ. ದೀಪ ಕಡಿಮೆ ಮಾಡಿ, ಲ್ಯಾಪ್‌ಟಾಪ್ ಮುಚ್ಚಿ, ದೀರ್ಘ ಉಸಿರು ತೆಗೆದುಕೊಳ್ಳಿ.",
};

export async function run(opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {}): Promise<SkillBaseResult> {
  return runSkill(
    {
      skill: "wind_down",
      importance: "normal",
      buildText: ({ lang }) => TEXT[lang] ?? TEXT.en,
    },
    opts,
  );
}
