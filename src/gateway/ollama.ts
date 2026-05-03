import { config } from "../config.js";

export type LlmRequest = {
  system: string;
  user: string;
  fallback: string;
};

export async function narrate(req: LlmRequest): Promise<{ text: string; source: "ollama" | "fallback" }> {
  if (!config.ollama.url) {
    return { text: req.fallback, source: "fallback" };
  }
  try {
    const res = await fetch(`${config.ollama.url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollama.model,
        system: req.system,
        prompt: req.user,
        stream: false,
        options: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn("[ollama] not ok, falling back");
      return { text: req.fallback, source: "fallback" };
    }
    const json = (await res.json()) as { response?: string };
    const text = json.response?.trim();
    if (!text) return { text: req.fallback, source: "fallback" };
    return { text, source: "ollama" };
  } catch (e) {
    console.warn("[ollama] failed, falling back:", (e as Error).message);
    return { text: req.fallback, source: "fallback" };
  }
}
