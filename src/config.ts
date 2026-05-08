import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ROOT = resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  tickIntervalSec: Number(process.env.TICK_INTERVAL_SEC ?? 30),
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  },
  ollama: {
    url: process.env.OLLAMA_URL ?? "",
    model: process.env.OLLAMA_MODEL ?? "llama3.2",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
  },
  audit: {
    secret: process.env.AUDIT_HMAC_SECRET ?? "dev-secret-change-me",
  },
  paths: {
    db: resolve(ROOT, "data", "aura.db"),
    soul: resolve(ROOT, "SOUL.md"),
    heartbeat: resolve(ROOT, "HEARTBEAT.yaml"),
    twin: resolve(ROOT, "TWIN.md"),
    skills: resolve(ROOT, "src", "skills"),
    publicDir: resolve(ROOT, "public"),
  },
};
