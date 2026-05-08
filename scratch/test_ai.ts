import { narrate } from "../src/gateway/ollama.js";
import { getSystemState, formatContextForLLM } from "../src/pi-engine/context.js";

async function test() {
  console.log("Testing Ollama with FULL PRODUCTION CONTEXT...");
  const state = getSystemState();
  const contextStr = formatContextForLLM(state);
  
  const res = await narrate({
    system: `You are AURA, the user's proactive digital twin.
MISSION:
- You know the user's 7AM/8AM routine from TWIN.md. 
- Answer questions about their life, health, and schedule naturally.
- Keep it under 200 chars. No "I am an AI".

CONTEXT:
${contextStr}`,
    user: "Brief me about my morning routine.",
    fallback: "FAILED"
  });
  console.log("AURA Response:", res.text);
  console.log("Source:", res.source);
}

test();
