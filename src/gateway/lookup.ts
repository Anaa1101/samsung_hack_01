// Free, keyless lookup APIs. All have public, generous rate limits.

const TIMEOUT = 5000;

async function safeFetch(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Wikipedia REST summary
export async function wikiSummary(topic: string): Promise<{ ok: boolean; text: string; url?: string }> {
  const slug = encodeURIComponent(topic.trim().replace(/\s+/g, "_"));
  const json = (await safeFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`)) as
    | { extract?: string; content_urls?: { desktop?: { page?: string } } }
    | null;
  if (!json?.extract) return { ok: false, text: `I couldn't find anything about ${topic}.` };
  // Trim to one or two sentences for spoken brevity.
  const sentences = json.extract.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return { ok: true, text: sentences, url: json.content_urls?.desktop?.page };
}

// Free Dictionary API
export async function defineWord(word: string): Promise<{ ok: boolean; text: string }> {
  const slug = encodeURIComponent(word.trim().toLowerCase());
  const json = (await safeFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${slug}`)) as
    | Array<{ meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }> }> }>
    | null;
  if (!Array.isArray(json) || !json[0]?.meanings?.[0]) {
    return { ok: false, text: `I couldn't find a definition for ${word}.` };
  }
  const m = json[0].meanings[0];
  const def = m.definitions[0]?.definition ?? "(no definition)";
  return { ok: true, text: `${word}, ${m.partOfSpeech}: ${def}` };
}

// JokeAPI
export async function tellJoke(): Promise<{ ok: boolean; text: string }> {
  const json = (await safeFetch(
    "https://v2.jokeapi.dev/joke/Any?safe-mode&blacklistFlags=racist,sexist",
  )) as
    | { type?: "single" | "twopart"; joke?: string; setup?: string; delivery?: string }
    | null;
  if (!json) return { ok: false, text: "I don't have a joke right now." };
  if (json.type === "twopart") return { ok: true, text: `${json.setup} … ${json.delivery}` };
  return { ok: true, text: json.joke ?? "I don't have a joke right now." };
}
