// macOS system actions — volume, lock screen, screenshot, AppleScript wrappers.
// All best-effort. Never throw on failure; return { ok: boolean }.

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { append as auditAppend } from "../audit/log.js";

function osascript(script: string): { ok: boolean; out?: string; err?: string } {
  if (process.platform !== "darwin") return { ok: false, err: "not macOS" };
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout?.trim(), err: r.stderr?.trim() };
}

export function setVolume(pct: number): { ok: boolean; pct: number } {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const r = osascript(`set volume output volume ${clamped}`);
  auditAppend("system_action", { kind: "volume_set", pct: clamped, ok: r.ok });
  return { ok: r.ok, pct: clamped };
}

export function getVolume(): number {
  const r = osascript("output volume of (get volume settings)");
  return r.ok ? Number(r.out ?? 50) : 50;
}

export function adjustVolume(deltaPct: number): { ok: boolean; pct: number } {
  return setVolume(getVolume() + deltaPct);
}

export function muteVolume(): { ok: boolean } {
  const r = osascript("set volume with output muted");
  auditAppend("system_action", { kind: "volume_mute", ok: r.ok });
  return { ok: r.ok };
}

export function unmuteVolume(): { ok: boolean } {
  const r = osascript("set volume without output muted");
  auditAppend("system_action", { kind: "volume_unmute", ok: r.ok });
  return { ok: r.ok };
}

export function lockScreen(): { ok: boolean } {
  // Cmd+Ctrl+Q
  const r = osascript(
    'tell application "System Events" to keystroke "q" using {command down, control down}',
  );
  auditAppend("system_action", { kind: "lock_screen", ok: r.ok });
  return { ok: r.ok };
}

export function takeScreenshot(): { ok: boolean; path?: string } {
  if (process.platform !== "darwin") return { ok: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(homedir(), "Desktop", `aura-${stamp}.png`);
  try {
    const child = spawn("screencapture", ["-i", path], { stdio: "ignore" });
    auditAppend("system_action", { kind: "screenshot", path });
    return { ok: true, path };
  } catch {
    return { ok: false };
  }
}
