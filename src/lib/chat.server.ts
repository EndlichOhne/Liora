import type { AttachmentRef, Citation, MemoryProposal, Mode } from "@/lib/domain";
import { extractMemory, isMode } from "@/lib/domain";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import type { ChatPart, ProviderMessage } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/xai.server";
import {
  assertRate,
  createConversation,
  deleteFromMessage,
  deleteLastAssistant,
  ensureProfile,
  getOwnedConversation,
  insertMessage,
  listMemories,
  loadFilesForPrompt,
  loadRecentMessages,
  maybeTitle,
  projectContext,
  recordUsage,
  updateMessage,
} from "@/lib/data.server";
import { loadPromptContext, onAssistantAnswer, onUserMessage, recordPerf } from "@/lib/intelligence/store";

export type ChatInput = {
  conversationId?: string | null;
  projectId?: string | null;
  content?: string;
  mode?: string;
  attachmentIds?: string[];
  forceImage?: boolean;
  regenerate?: boolean;
  replaceFromMessageId?: string | null;
};

type Write = (event: Record<string, unknown>) => void;

const MAX_TOKENS: Record<Mode, number> = {
  normal: 1400,
  think: 4000,
  research: 2200,
  code: 3200,
  writing: 2400,
  analysis: 2600,
};

function wantsImage(text: string, force: boolean) {
  if (force) return true;
  const t = text.toLowerCase();
  const verb = /(erstelle|generiere|zeichne|male|designe|create|generate|draw|design)\b/.test(t);
  const noun = /(bild|logo|icon|illustration|poster|foto|image|picture|wallpaper)\b/.test(t);
  return verb && noun;
}

function shouldSearch(mode: Mode, text: string) {
  if (mode === "research") return true;
  if (mode === "code" || mode === "writing") return false;
  return /\b(aktuell|heute|gerade|news|nachrichten|preis|kurs|wetter|latest|today|current|recent|20(2[4-9]|3\d))\b/i.test(
    text,
  );
}

function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export async function runChat(opts: { userId: string; body: ChatInput; signal: AbortSignal; write: Write }) {
  const { userId, signal, write } = opts;
  const body = opts.body ?? {};
  const mode: Mode = typeof body.mode === "string" && isMode(body.mode) ? body.mode : "normal";
  const regenerate = Boolean(body.regenerate);
  const content = (body.content ?? "").trim().slice(0, 32_000);
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id): id is string => typeof id === "string").slice(0, 6)
    : [];

  if (!regenerate && !content && attachmentIds.length === 0) {
    throw new Error("Schreib eine Nachricht oder hänge eine Datei an.");
  }

  await assertRate(userId, "chat", 24, "10 minutes");
  const profile = await ensureProfile(userId);

  let conversationId = body.conversationId || "";
  if (conversationId) {
    const owned = await getOwnedConversation(userId, conversationId);
    if (!owned) throw new Error("Unterhaltung nicht gefunden.");
  } else {
    const created = await createConversation(userId, {
      projectId: body.projectId ?? null,
      mode,
      title: content ? content.replace(/\s+/g, " ").slice(0, 72) : "Neue Unterhaltung",
    });
    conversationId = created.id;
  }

  if (regenerate) {
    await deleteLastAssistant(userId, conversationId);
  } else if (body.replaceFromMessageId) {
    await deleteFromMessage(userId, conversationId, body.replaceFromMessageId);
  }

  let userAttachments: AttachmentRef[] = [];
  let userContent = content;
  if (!regenerate) {
    const files = await loadFilesForPrompt(userId, attachmentIds);
    userAttachments = files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, kind: f.kind }));
    const saved = await insertMessage({
      userId,
      conversationId,
      role: "user",
      content: userContent || "(Datei angehängt)",
      attachments: userAttachments,
      status: "complete",
    });
    await maybeTitle(userId, conversationId, userContent || files[0]?.name || "Datei");
    const prior = await loadRecentMessages(userId, conversationId, 8);
    const priorAnswer = [...prior].reverse().find((item) => item.role === "assistant")?.content ?? "";
    try {
      const note = await onUserMessage(userId, userContent, priorAnswer);
      if (note) write({ type: "learning", text: note });
    } catch {
      /* learning must not block the reply */
    }
    write({
      type: "ready",
      conversationId,
      userMessage: saved,
    });
  } else {
    const history = await loadRecentMessages(userId, conversationId, 8);
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (!lastUser) throw new Error("Es gibt keine Nachricht zum erneuten Beantworten.");
    userContent = lastUser.content;
    userAttachments = lastUser.attachments;
    write({ type: "ready", conversationId });
  }

  const assistant = await insertMessage({
    userId,
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  write({ type: "assistant", message: assistant });

  const files = await loadFilesForPrompt(
    userId,
    userAttachments.map((a) => a.id),
  );
  const imageRequest = wantsImage(userContent, Boolean(body.forceImage)) && files.every((f) => f.kind !== "image" || Boolean(body.forceImage));

  const finish = async (
    status: "complete" | "error" | "stopped",
    raw: string,
    reasoning: string,
    citations: Citation[],
    imageData: string | null,
  ) => {
    const extracted = extractMemory(raw);
    const text = extracted.text || (status === "stopped" ? "Antwort gestoppt." : "");
    await updateMessage(userId, assistant.id, {
      content: text || (status === "error" ? raw : ""),
      reasoning: reasoning.slice(0, 8000),
      citations: citations.slice(0, 12),
      imageData,
      status,
    });
    if (extracted.proposal && status === "complete") {
      write({ type: "memory", proposal: extracted.proposal satisfies MemoryProposal });
    }
    const message = {
      ...assistant,
      content: text,
      reasoning,
      citations: citations.slice(0, 12),
      imageData,
      status,
    };
    write({ type: "done", message });
    return message;
  };

  try {
    if (imageRequest) {
      await assertRate(userId, "image", 6, "1 hour");
      await recordUsage(userId, "image");
      const provider = getAIProvider("xai");
      const image = await provider.generateImage(userContent, signal);
      await finish("complete", "Hier ist das Bild.", "", [], image.dataUrl);
      return;
    }

    await recordUsage(userId, "chat");
    const started = Date.now();
    const [memories, project, history, learned] = await Promise.all([
      listMemories(userId),
      projectContext(userId, (await getOwnedConversation(userId, conversationId))?.project_id ?? body.projectId ?? null),
      loadRecentMessages(userId, conversationId, 24),
      loadPromptContext(userId).catch(() => ({ rules: [], facts: [], withheld: 0 })),
    ]);

    const system = buildSystemPrompt({
      profile,
      memories: memories.slice(0, 40),
      project,
      mode,
      learned,
    });

    const messages: ProviderMessage[] = [{ role: "system", content: system }];
    const prior = history.filter((m) => m.id !== assistant.id);
    for (const message of prior.slice(0, -1)) {
      const note = message.attachments.length
        ? `\n[Angehängte Dateien: ${message.attachments.map((a) => a.name).join(", ")}]`
        : "";
      messages.push({
        role: message.role,
        content: `${message.content.slice(0, 6000)}${note}`.slice(0, 8000),
      });
    }

    const parts: ChatPart[] = [];
    const fileBlocks = files
      .filter((f) => f.kind !== "image")
      .map((f) => `<document name="${f.name}">\n${(f.extracted_text || "").slice(0, 12_000)}\n</document>`)
      .join("\n\n")
      .slice(0, 36_000);
    const requestText = userContent || "Bitte analysiere die angehängten Dateien.";
    parts.push({
      type: "text",
      text: fileBlocks ? `${requestText}\n\n${fileBlocks}` : requestText,
    });
    for (const file of files.filter((f) => f.kind === "image" && f.image_data).slice(0, 3)) {
      if ((file.image_data ?? "").length < 3_500_000) {
        parts.push({ type: "image_url", url: file.image_data as string });
      }
    }
    messages.push({ role: "user", content: parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts });

    const provider = getAIProvider("xai");
    let raw = "";
    let reasoning = "";
    const citations: Citation[] = [];
    const webSearch = shouldSearch(mode, userContent) && !files.some((f) => f.kind === "image" && parts.length > 1);
    for await (const event of provider.streamChat({
      model: profile.modelId || "grok-4.5",
      messages,
      maxTokens: MAX_TOKENS[mode],
      webSearch,
      signal,
    })) {
      if (signal.aborted) break;
      if (event.type === "delta") {
        raw += event.text;
        write({ type: "delta", text: event.text });
      } else if (event.type === "reasoning") {
        reasoning += event.text;
        if (reasoning.length < 12_000) write({ type: "reasoning", text: event.text });
      } else if (event.type === "citations") {
        for (const item of event.items) {
          if (!citations.some((c) => c.url === item.url)) citations.push(item);
        }
        write({ type: "citations", items: citations.slice(0, 12) });
      }
    }

    if (signal.aborted) {
      await finish("stopped", raw, reasoning, citations, null);
      return;
    }
    if (!raw.trim()) {
      await finish("error", "Die KI hat keine Antwort geliefert.", reasoning, citations, null);
      await recordPerf(userId, "chat", Date.now() - started, false).catch(() => undefined);
      return;
    }
    const message = await finish("complete", raw, reasoning, citations, null);
    await recordPerf(userId, "chat", Date.now() - started, true).catch(() => undefined);
    await onAssistantAnswer(userId, {
      messageId: assistant.id,
      answer: message.content,
      userText: userContent,
      citations,
      mode,
    }).catch(() => undefined);
    return;
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      await updateMessage(userId, assistant.id, { content: "Antwort gestoppt.", status: "stopped" });
      write({
        type: "done",
        message: { ...assistant, content: "Antwort gestoppt.", status: "stopped" },
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Die Antwort konnte nicht erzeugt werden.";
    await updateMessage(userId, assistant.id, { content: message, status: "error" });
    write({ type: "error", message });
    write({
      type: "done",
      message: { ...assistant, content: message, status: "error" },
    });
  }
}

export { speakable };
