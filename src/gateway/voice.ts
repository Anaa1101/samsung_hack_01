// Voice gateway — uses macOS built-in `say` command. No API key, no install.
// Falls back to silent if `say` isn't available (Linux/Windows) or VOICE_ENABLED=0.

import { spawn } from "node:child_process";

let voiceEnabled = process.env.VOICE_ENABLED !== "0";
const VOICE_NAME = process.env.VOICE_NAME ?? "Samantha"; // try Daniel, Karen, Tessa, Samantha

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

export function setVoiceEnabled(enabled: boolean): void {
  voiceEnabled = enabled;
}

export function speak(text: string): { spoken: boolean; voice: string } {
  if (!voiceEnabled) return { spoken: false, voice: VOICE_NAME };
  if (process.platform !== "darwin") return { spoken: false, voice: VOICE_NAME };
  try {
    const child = spawn("say", ["-v", VOICE_NAME, text], { detached: true, stdio: "ignore" });
    child.unref();
    return { spoken: true, voice: VOICE_NAME };
  } catch {
    return { spoken: false, voice: VOICE_NAME };
  }
}
