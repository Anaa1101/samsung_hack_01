// Voice gateway — uses OS built-in commands. No API key required.
// macOS: `say`
// Windows: `PowerShell Add-Type -AssemblyName System.Speech`
// Linux: falls back to silent.

import { spawn } from "node:child_process";
import { isShuttingDown } from "../db.js";

let voiceEnabled = process.env.VOICE_ENABLED !== "0";
const VOICE_NAME = process.env.VOICE_NAME ?? (process.platform === "darwin" ? "Samantha" : "Microsoft David");

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

export function setVoiceEnabled(enabled: boolean): void {
  voiceEnabled = enabled;
}

export function speak(text: string): { spoken: boolean; voice: string } {
  if (!voiceEnabled || isShuttingDown()) return { spoken: false, voice: VOICE_NAME };

  try {
    if (process.platform === "darwin") {
      const child = spawn("say", ["-v", VOICE_NAME, text], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { spoken: true, voice: VOICE_NAME };
    }

    if (process.platform === "win32") {
      // Use PowerShell to synthesize speech on Windows.
      // We escape double quotes in the text to avoid breaking the PS command string.
      const escaped = text.replace(/"/g, '""');
      const psCommand = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("${escaped}")`;
      const child = spawn("powershell", ["-Command", psCommand], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { spoken: true, voice: "System.Speech" };
    }

    return { spoken: false, voice: VOICE_NAME };
  } catch {
    return { spoken: false, voice: VOICE_NAME };
  }
}

export async function speakWithRetry(
  text: string,
  attempts = 3,
  delayMs = 500,
): Promise<{ spoken: boolean; voice: string; attempts: number }> {
  let last = speak(text);
  let count = 1;
  while (!last.spoken && count < attempts && !isShuttingDown()) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = speak(text);
    count++;
  }
  return { ...last, attempts: count };
}
