import type { Citation } from "@/lib/domain";

/**
 * Swap-point for model vendors. The running app talks only to this interface.
 * Today the only configured implementation is xAI (`XAI_API_KEY`, server-only).
 * Adding OpenAI, Anthropic or Google means a new module that satisfies
 * `AIProvider` plus a server-side key — never a browser key.
 */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
};

export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "citations"; items: Citation[] };

export type ChatRequest = {
  model: string;
  messages: ProviderMessage[];
  maxTokens: number;
  webSearch: boolean;
  signal?: AbortSignal;
};

export interface AIProvider {
  readonly id: string;
  streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent>;
  generateImage(prompt: string, signal?: AbortSignal): Promise<{ dataUrl: string }>;
  synthesizeSpeech(text: string, voiceId: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export function assertModelId(id: string): string {
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(trimmed)) {
    throw new Error("Ungültige Modell-ID.");
  }
  return trimmed;
}
