import { runSkill, type SkillBaseResult } from "../_lib.js";
import type { Lang } from "../../i18n.js";

const TEXT: Record<Lang, string[]> = {
  en: [
    "Quick water break. Hydrate.",
    "Time for a sip of water.",
    "Drink some water — you've been at it a while.",
  ],
  hi: ["पानी पी लीजिए।", "थोड़ा पानी पीने का समय।", "हाइड्रेट रहें — पानी पिएँ।"],
  kn: ["ನೀರು ಕುಡಿಯಿರಿ.", "ಸ್ವಲ್ಪ ನೀರು ಕುಡಿಯುವ ಸಮಯ.", "ಹೈಡ್ರೇಟ್ ಆಗಿರಿ — ನೀರು ಕುಡಿಯಿರಿ."],
};

export async function run(opts: { dry_run?: boolean; now?: Date; lang?: Lang } = {}): Promise<SkillBaseResult> {
  return runSkill(
    {
      skill: "hydration_reminder",
      importance: "normal",
      buildText: ({ lang }) => {
        const arr = TEXT[lang] ?? TEXT.en;
        return arr[Math.floor(Math.random() * arr.length)];
      },
    },
    opts,
  );
}
