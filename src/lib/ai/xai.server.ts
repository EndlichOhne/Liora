import type { Citation } from "@/lib/domain";
import type { AIProvider, ChatRequest, ProviderEvent, ProviderMessage } from "@/lib/ai/provider";

const CHAT_URL = "https://api.x.ai/v1/chat/completions";
const RESPONSES_URL = "https://api.x.ai/v1/responses";
const IMAGE_URL = "https://api.x.ai/v1/images/generations";
const TTS_URL = "https://api.x.ai/v1/tts";

function apiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new Error("KI ist hier nicht verfügbar. Serverseitig fehlt XAI_API_KEY.");
  }
  return key;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function postOnce(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const key = apiKey();
  let res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if ((res.status === 429 || res.status === 502 || res.status === 503) && !signal?.aborted) {
    await res.body?.cancel().catch(() => undefined);
    await sleep(800, signal);
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  }
  return res;
}

function friendlyStatus(status: number, detail: string): string {
  const clean = detail.replace(/\s+/g, " ").slice(0, 240);
  if (status === 401 || status === 403) return "Der KI-Dienst hat den Zugriff abgelehnt.";
  if (status === 429) return "Der KI-Dienst ist gerade ausgelastet. Bitte kurz warten und erneut versuchen.";
  if (status >= 500) return "Der KI-Dienst ist gerade nicht erreichbar. Deine Nachricht bleibt im Chat.";
  if (clean) return `Der KI-Dienst hat die Anfrage abgelehnt (${status}): ${clean}`;
  return `Der KI-Dienst hat die Anfrage abgelehnt (${status}).`;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    if (json.error && typeof json.error.message === "string") return json.error.message;
  } catch {
    /* plain text */
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pushCitation(out: Citation[], value: unknown) {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    if (!out.some((c) => c.url === value)) out.push({ url: value });
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  const url = typeof rec.url === "string" ? rec.url : typeof rec.uri === "string" ? rec.uri : "";
  if (!/^https?:\/\//.test(url)) return;
  if (out.some((c) => c.url === url)) return;
  const title = typeof rec.title === "string" ? rec.title.slice(0, 200) : undefined;
  const snippet =
    typeof rec.snippet === "string"
      ? rec.snippet.slice(0, 400)
      : typeof rec.text === "string"
        ? rec.text.slice(0, 400)
        : undefined;
  const publishedAt =
    typeof rec.published_at === "string"
      ? rec.published_at
      : typeof rec.date === "string"
        ? rec.date
        : undefined;
  out.push({
    url,
    ...(title ? { title } : {}),
    ...(snippet ? { snippet } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  });
}

function collectCitations(node: unknown, out: Citation[], depth = 0) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    if (node.every((item) => typeof item === "string")) {
      for (const item of node) pushCitation(out, item);
      return;
    }
    for (const item of node) collectCitations(item, out, depth + 1);
    return;
  }
  const rec = asRecord(node);
  if (!rec) return;
  if ("url" in rec || "uri" in rec) pushCitation(out, rec);
  for (const key of ["citations", "sources", "annotations"]) {
    if (key in rec) collectCitations(rec[key], out, depth + 1);
  }
}

function eventsFromChunk(json: unknown): ProviderEvent[] {
  const rec = asRecord(json);
  if (!rec) return [];
  const events: ProviderEvent[] = [];
  const choice = Array.isArray(rec.choices) ? asRecord(rec.choices[0]) : null;
  const delta = choice ? asRecord(choice.delta) : null;
  if (delta) {
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      events.push({ type: "reasoning", text: delta.reasoning_content });
    }
    if (typeof delta.content === "string" && delta.content) {
      events.push({ type: "delta", text: delta.content });
    }
  }
  if (typeof rec.delta === "string" && rec.delta && String(rec.type ?? "").includes("output_text")) {
    events.push({ type: "delta", text: rec.delta });
  }
  const citations: Citation[] = [];
  collectCitations(rec.citations, citations);
  if (rec.response) collectCitations(asRecord(rec.response)?.citations, citations);
  if (citations.length) events.push({ type: "citations", items: citations });
  return events;
}

async function* parseSse(res: Response, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  if (!res.body) throw new Error("Der KI-Dienst hat keinen Stream geliefert.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          for (const event of eventsFromChunk(JSON.parse(data))) yield event;
        } catch {
          /* ignore keepalives */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function toResponsesInput(messages: ProviderMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: "input_text", text: part.text }
          : { type: "input_image", image_url: part.url },
      ),
    };
  });
}

function toCompletionMessages(messages: ProviderMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: "text", text: part.text }
          : { type: "image_url", image_url: { url: part.url } },
      ),
    };
  });
}

async function* streamCompletions(req: ChatRequest, search: boolean): AsyncGenerator<ProviderEvent> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toCompletionMessages(req.messages),
    stream: true,
    max_tokens: req.maxTokens,
  };
  if (search) {
    body.search_parameters = {
      mode: "on",
      return_citations: true,
      max_search_results: 6,
    };
  }
  const res = await postOnce(CHAT_URL, body, req.signal);
  if (!res.ok) {
    const detail = await readError(res);
    throw new Error(friendlyStatus(res.status, detail));
  }
  yield* parseSse(res, req.signal);
}

export const xaiProvider: AIProvider = {
  id: "xai",

  async *streamChat(req) {
    if (req.webSearch) {
      const res = await postOnce(
        RESPONSES_URL,
        {
          model: req.model,
          input: toResponsesInput(req.messages),
          stream: true,
          max_output_tokens: req.maxTokens,
          tools: [{ type: "web_search" }],
        },
        req.signal,
      );
      if (res.ok) {
        yield* parseSse(res, req.signal);
        return;
      }
      const detail = await readError(res);
      if (res.status !== 400 && res.status !== 404 && res.status !== 422) {
        throw new Error(friendlyStatus(res.status, detail));
      }
      yield* streamCompletions(req, true);
      return;
    }
    yield* streamCompletions(req, false);
  },

  async generateImage(prompt, signal) {
    const models = ["grok-imagine-image", "grok-imagine-image-quality"];
    let lastError = "Bildgenerierung ist fehlgeschlagen.";
    for (let i = 0; i < models.length; i += 1) {
      const res = await postOnce(
        IMAGE_URL,
        {
          model: models[i],
          prompt: prompt.slice(0, 4000),
          n: 1,
          response_format: "b64_json",
        },
        signal,
      );
      if (!res.ok) {
        lastError = friendlyStatus(res.status, await readError(res));
        if (i === 0 && (res.status === 400 || res.status === 404)) continue;
        throw new Error(lastError);
      }
      const json = (await res.json()) as {
        data?: { url?: string; b64_json?: string }[];
      };
      const first = json.data?.[0];
      if (first?.b64_json) {
        return { dataUrl: `data:image/png;base64,${first.b64_json}` };
      }
      if (first?.url) {
        const img = await fetch(first.url, { signal });
        if (!img.ok) throw new Error("Das Bild wurde erzeugt, konnte aber nicht gespeichert werden.");
        const buf = Buffer.from(await img.arrayBuffer());
        if (buf.byteLength > 5_000_000) throw new Error("Das Bild ist zu groß zum Speichern.");
        const mime = img.headers.get("content-type")?.split(";")[0] || "image/png";
        if (!mime.startsWith("image/")) throw new Error("Unerwartetes Bildformat.");
        return { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
      }
      lastError = "Der Bilddienst hat kein Bild zurückgegeben.";
    }
    throw new Error(lastError);
  },

  async synthesizeSpeech(text, voiceId, signal) {
    const res = await postOnce(
      TTS_URL,
      { text: text.slice(0, 1800), voice_id: voiceId || "eve" },
      signal,
    );
    if (!res.ok) throw new Error(friendlyStatus(res.status, await readError(res)));
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 80) throw new Error("Die Stimme hat keine Audiodaten geliefert.");
    return buf;
  },
};

export function getAIProvider(id = "xai"): AIProvider {
  if (id === "xai") return xaiProvider;
  throw new Error(
    `Anbieter \u201e${id}\u201c ist nicht konfiguriert. Aktiv ist xAI \u00fcber die serverseitige Variable XAI_API_KEY. Weitere Anbieter k\u00f6nnen als AIProvider erg\u00e4nzt werden.`,
  );
}
