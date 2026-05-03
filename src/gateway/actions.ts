// Action gateway — uses macOS `open` to launch URLs, files, and apps.
// Every action is logged to the audit chain so judges can replay them.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { append as auditAppend } from "../audit/log.js";

export type ActionResult = {
  ok: boolean;
  kind: "url" | "file" | "search" | "app" | "noop";
  target: string;
  message: string;
};

function runOpen(args: string[]): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const child = spawn("open", args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function openUrl(url: string): ActionResult {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const ok = runOpen([url]);
  const result: ActionResult = {
    ok,
    kind: "url",
    target: url,
    message: ok ? `Opened ${url}` : `Could not open ${url}`,
  };
  auditAppend("action", result);
  return result;
}

export function openFile(path: string): ActionResult {
  let resolved = path;
  if (path.startsWith("~")) resolved = resolve(homedir(), path.slice(1).replace(/^\//, ""));
  if (!existsSync(resolved)) {
    const result: ActionResult = {
      ok: false,
      kind: "file",
      target: resolved,
      message: `File not found: ${resolved}`,
    };
    auditAppend("action", result);
    return result;
  }
  const ok = runOpen([resolved]);
  const result: ActionResult = {
    ok,
    kind: "file",
    target: resolved,
    message: ok ? `Opened ${resolved}` : `Could not open ${resolved}`,
  };
  auditAppend("action", result);
  return result;
}

export function webSearch(query: string): ActionResult {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const ok = runOpen([url]);
  const result: ActionResult = {
    ok,
    kind: "search",
    target: query,
    message: ok ? `Searching for "${query}"` : `Could not open browser`,
  };
  auditAppend("action", result);
  return result;
}

// Friendly name → bundle id mapping. Add more as needed.
const APP_ALIASES: Record<string, string> = {
  spotify: "Spotify",
  notion: "Notion",
  slack: "Slack",
  chrome: "Google Chrome",
  safari: "Safari",
  notes: "Notes",
  calendar: "Calendar",
  mail: "Mail",
  messages: "Messages",
  finder: "Finder",
  terminal: "Terminal",
  vscode: "Visual Studio Code",
  "vs code": "Visual Studio Code",
  "visual studio code": "Visual Studio Code",
  cursor: "Cursor",
  zoom: "zoom.us",
  arc: "Arc",
  obsidian: "Obsidian",
  figma: "Figma",
};

export function openApp(name: string): ActionResult {
  const lookup = APP_ALIASES[name.trim().toLowerCase()] ?? name;
  const ok = runOpen(["-a", lookup]);
  const result: ActionResult = {
    ok,
    kind: "app",
    target: lookup,
    message: ok ? `Opened ${lookup}` : `Could not open app ${lookup}`,
  };
  auditAppend("action", result);
  return result;
}

// Well-known shortcuts the user mentioned in their message. Easy to extend.
export const SHORTCUTS: Record<string, () => ActionResult> = {
  prism: () => openUrl("https://arxiv.org/pdf/2602.01532"),
  "prism paper": () => openUrl("https://arxiv.org/pdf/2602.01532"),
  "the prism paper": () => openUrl("https://arxiv.org/pdf/2602.01532"),
  "aura doc": () => openFile("~/Downloads/Untitled document (13).pdf"),
  "the aura doc": () => openFile("~/Downloads/Untitled document (13).pdf"),
};
