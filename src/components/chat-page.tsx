import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Copy,
  ImageIcon,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { getBearerToken } from "@/lib/auth/client";
import {
  CATEGORY_LABEL,
  KNOWN_MODELS,
  MODE_LABEL,
  MODES,
  formatWhen,
  hostOf,
  visibleContent,
  type AttachmentRef,
  type Citation,
  type ConversationDTO,
  type FileDTO,
  type MemoryProposal,
  type MessageDTO,
  type Mode,
} from "@/lib/domain";
import { listChats, loadMessages, removeChat, renameChat, saveProfile, upsertMemory } from "@/lib/data.functions";
import { useApp } from "@/components/app-frame";
import { MarkdownView } from "@/components/markdown-view";

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

async function fileToBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function uploadClientFile(file: File, projectId?: string | null): Promise<FileDTO> {
  const { addFile } = await import("@/lib/data.functions");
  const base64 = await fileToBase64(file);
  return addFile({ data: { name: file.name, mime: file.type || "application/octet-stream", base64, projectId: projectId ?? null } });
}

export function ChatPage({
  conversationId,
  projectId,
}: {
  conversationId?: string;
  projectId?: string;
}) {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useApp();
  const [chats, setChats] = useState<ConversationDTO[]>([]);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [mode, setMode] = useState<Mode>("normal");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [proposal, setProposal] = useState<MemoryProposal | null>(null);
  const [learningNote, setLearningNote] = useState("");
  const [forceImage, setForceImage] = useState(false);
  const [composing, setComposing] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveConv = useRef<string | null>(null);
  const stick = useRef(true);

  async function refreshChats(q = query) {
    const rows = await listChats({ data: { query: q, projectId: null, before: null } });
    setChats(rows);
  }

  useEffect(() => {
    void refreshChats().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refreshChats(query).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    if (liveConv.current === conversationId) return;
    let cancelled = false;
    void loadMessages({ data: { conversationId, before: null } })
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        setHasMore(res.hasMore);
        const found = chats.find((c) => c.id === conversationId);
        if (found) setMode(found.mode);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Chat konnte nicht geladen werden."));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!stick.current) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    const raw = sessionStorage.getItem("liora-prefill");
    if (!raw) return;
    sessionStorage.removeItem("liora-prefill");
    try {
      const parsed = JSON.parse(raw) as { prompt?: string; file?: FileDTO; autosend?: boolean };
      if (parsed.file) setFiles([parsed.file]);
      if (parsed.prompt) setDraft(parsed.prompt);
      if (parsed.autosend && parsed.prompt) {
        window.setTimeout(() => {
          void send(parsed.prompt ?? "", { attachmentIds: parsed.file ? [parsed.file.id] : [], presetFiles: parsed.file ? [parsed.file] : [] });
        }, 50);
      }
    } catch {
      /* ignore bad prefill */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = "";
  }

  async function speak(text: string) {
    if (!voiceOn && !profile?.voiceAuto) return;
    stopAudio();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getBearerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch("/api/speak", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ text, voiceId: profile?.voiceId }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error || "Stimme nicht verfügbar.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = url;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play().catch(() => setError("Wiedergabe wurde vom Browser blockiert."));
  }

  async function send(
    text: string,
    opts?: { regenerate?: boolean; replaceFromMessageId?: string | null; attachmentIds?: string[]; presetFiles?: FileDTO[] },
  ) {
    const content = text.trim();
    const attachmentIds = opts?.attachmentIds ?? files.map((f) => f.id);
    if (!opts?.regenerate && !content && attachmentIds.length === 0) return;
    setError("");
    setProposal(null);
    stopAudio();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    stick.current = true;
    liveConv.current = conversationId ?? "new";
    if (!opts?.regenerate) {
      setDraft("");
      setFiles([]);
      setEditingId(null);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getBearerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let assistantId = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        credentials: "include",
        signal: ac.signal,
        body: JSON.stringify({
          conversationId: conversationId ?? null,
          projectId: projectId ?? null,
          content,
          mode,
          attachmentIds,
          forceImage,
          regenerate: Boolean(opts?.regenerate),
          replaceFromMessageId: opts?.replaceFromMessageId ?? null,
        }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error || "Die Anfrage ist fehlgeschlagen. Dein Text bleibt im Feld.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim()) as {
            type: string;
            conversationId?: string;
            userMessage?: MessageDTO;
            message?: MessageDTO;
            text?: string;
            items?: Citation[];
            proposal?: MemoryProposal;
            messageText?: string;
          };
          if (event.type === "ready" && event.conversationId) {
            liveConv.current = event.conversationId;
            if (event.conversationId !== conversationId) {
              void navigate({
                to: "/",
                search: { c: event.conversationId, project: projectId },
                replace: true,
              });
            }
            if (event.userMessage) {
              setMessages((prev) => {
                if (opts?.replaceFromMessageId) {
                  const idx = prev.findIndex((m) => m.id === opts.replaceFromMessageId);
                  const base = idx >= 0 ? prev.slice(0, idx) : prev;
                  return [...base, event.userMessage!];
                }
                return [...prev, event.userMessage!];
              });
            }
            if (opts?.regenerate) {
              setMessages((prev) => {
                const copy = [...prev];
                if (copy.at(-1)?.role === "assistant") copy.pop();
                return copy;
              });
            }
            void refreshChats();
          } else if (event.type === "assistant" && event.message) {
            assistantId = event.message.id;
            setMessages((prev) => [...prev, event.message!]);
          } else if (event.type === "delta" && event.text) {
            const id = assistantId;
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + event.text } : m)));
          } else if (event.type === "reasoning" && event.text) {
            const id = assistantId;
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, reasoning: m.reasoning + event.text } : m)));
          } else if (event.type === "citations" && event.items) {
            const id = assistantId;
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, citations: event.items! } : m)));
          } else if (event.type === "learning" && event.text) {
            setLearningNote(event.text);
          } else if (event.type === "memory" && event.proposal) {
            setProposal(event.proposal);
          } else if (event.type === "done" && event.message) {
            setMessages((prev) => prev.map((m) => (m.id === event.message!.id ? event.message! : m)));
            if (event.message.status === "complete") {
              void speak(visibleContent(event.message.content));
              if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
                new Notification("Liora", { body: "Antwort ist fertig." });
              }
            }
            if (event.message.status === "error") setError(event.message.content);
          } else if (event.type === "error" && event.text === undefined) {
            const msg = (event as { message?: string }).message || "Fehler";
            setError(msg);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, status: "stopped", content: m.content || "Antwort gestoppt." } : m)),
        );
      } else {
        const message = err instanceof Error ? err.message : "Unbekannter Fehler";
        setError(message);
        if (!opts?.regenerate) setDraft(content);
        if (opts?.presetFiles) setFiles(opts.presetFiles);
        else if (attachmentIds.length) {
          /* files already cleared; user can reattach */
        }
      }
    } finally {
      setBusy(false);
      liveConv.current = null;
      setForceImage(false);
      void refreshChats();
    }
  }

  async function onPickFiles(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    try {
      const uploaded: FileDTO[] = [];
      for (const file of Array.from(list).slice(0, 6)) {
        uploaded.push(await uploadClientFile(file, projectId));
      }
      setFiles((prev) => [...prev, ...uploaded].slice(0, 6));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    }
  }

  function toggleMic() {
    const Ctor = speechCtor();
    if (!Ctor) {
      setError("Dieser Browser unterstützt keine Spracheingabe.");
      return;
    }
    if (listening) return;
    stopAudio();
    const rec = new Ctor();
    rec.lang = profile?.language === "en" ? "en-US" : "de-DE";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const said = ev.results[0]?.[0]?.transcript ?? "";
      if (!said) return;
      if (voiceOn) void send(said);
      else setDraft((d) => (d ? `${d} ${said}` : said));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError("Spracheingabe konnte nicht starten.");
    }
  }

  const showThread = Boolean(conversationId) || composing || messages.length > 0 || busy;
  const active = chats.find((c) => c.id === conversationId);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={`${showThread ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col border-r border-border lg:w-72`}>
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chats suchen"
              className="min-h-11 w-full rounded-md border border-border bg-card pr-3 pl-9 text-sm outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>
          <button
            type="button"
            aria-label="Neue Unterhaltung"
            className="inline-flex size-11 items-center justify-center rounded-md bg-accent text-accent-foreground"
            onClick={() => {
              abortRef.current?.abort();
              setComposing(true);
              setMessages([]);
              setMode("normal");
              void navigate({ to: "/", search: { project: projectId } });
            }}
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? (
            <div className="px-3 py-8">
              <p className="font-display text-2xl tracking-tight">Noch ruhig.</p>
              <p className="mt-2 text-sm text-muted">Eine neue Unterhaltung öffnet das Eingabefeld. Nichts wird still gespeichert.</p>
              <button
                type="button"
                className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm text-accent-foreground"
                onClick={() => {
                  setComposing(true);
                  setMessages([]);
                  void navigate({ to: "/", search: { project: projectId } });
                }}
              >
                Neue Unterhaltung
              </button>
            </div>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className={`group mb-1 rounded-md ${chat.id === conversationId ? "bg-subtle" : "hover:bg-subtle"}`}>
                {renameId === chat.id ? (
                  <form
                    className="flex gap-1 p-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void renameChat({ data: { id: chat.id, title: renameValue } }).then(() => {
                        setRenameId(null);
                        void refreshChats();
                      });
                    }}
                  >
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="min-h-10 min-w-0 flex-1 rounded-sm border border-border bg-card px-2 text-sm"
                    />
                    <button type="submit" className="min-h-10 px-2 text-sm" aria-label="Titel speichern">
                      <Check className="size-4" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2 py-2 text-left"
                      onClick={() => void navigate({ to: "/", search: { c: chat.id, project: chat.projectId ?? undefined } })}
                    >
                      <span className="block truncate text-sm">{chat.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {MODE_LABEL[chat.mode]} · {formatWhen(chat.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="mt-1 inline-flex min-h-11 min-w-9 items-center justify-center text-muted"
                      aria-label="Umbenennen"
                      onClick={() => {
                        setRenameId(chat.id);
                        setRenameValue(chat.title);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="mt-1 inline-flex min-h-11 min-w-9 items-center justify-center text-muted"
                      aria-label="Löschen"
                      onClick={() => {
                        if (!window.confirm("Diese Unterhaltung löschen?")) return;
                        void removeChat({ data: { id: chat.id } }).then(() => {
                          if (conversationId === chat.id) void navigate({ to: "/" });
                          void refreshChats();
                        });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      <section className={`${showThread ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
          <button
            type="button"
            className="inline-flex min-h-11 items-center px-1 text-sm text-muted lg:hidden"
            onClick={() => {
            setComposing(false);
            void navigate({ to: "/" });
          }}
          >
            Zurück
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{active?.title || "Neue Unterhaltung"}</p>
            <p className="text-xs text-muted">{MODE_LABEL[mode]} · {profile?.modelId || "Grok 4.5"}</p>
          </div>
        </header>

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {hasMore && conversationId ? (
              <button
                type="button"
                className="self-center text-sm text-muted underline-offset-4 hover:underline"
                onClick={() => {
                  const oldest = messages[0]?.createdAt;
                  if (!oldest) return;
                  void loadMessages({ data: { conversationId, before: oldest } }).then((res) => {
                    setMessages((prev) => [...res.messages, ...prev]);
                    setHasMore(res.hasMore);
                  });
                }}
              >
                Ältere Nachrichten
              </button>
            ) : null}
            {messages.length === 0 && !busy ? (
              <div className="px-1 pt-8 sm:pt-16">
                <p className="text-xs text-muted">Privat</p>
                <h2 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">Woran arbeiten wir?</h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                  Frage, Datei oder Bild. Liora merkt sich nur, was du ausdrücklich bestätigst.
                </p>
              </div>
            ) : null}
            {messages.map((message, index) => {
              const shown = visibleContent(message.content);
              const last = index === messages.length - 1;
              return (
                <article key={message.id} className={message.role === "user" ? "self-end max-w-[92%]" : "max-w-full"}>
                  {message.role === "user" ? (
                    <div className="rounded-lg rounded-br-sm bg-subtle px-3.5 py-2.5 text-sm leading-relaxed">
                      <p className="whitespace-pre-wrap">{shown}</p>
                      {message.attachments.length ? (
                        <p className="mt-2 text-xs text-muted">{message.attachments.map((a: AttachmentRef) => a.name).join(", ")}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div>
                      {message.reasoning ? (
                        <details className="mb-2 text-sm text-muted">
                          <summary className="cursor-pointer">Überlegung</summary>
                          <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
                        </details>
                      ) : null}
                      {shown ? <MarkdownView content={shown} /> : busy && last ? <p className="text-sm text-muted">Antwort wird geschrieben</p> : null}
                      {message.imageData ? (
                        <img src={message.imageData} alt="Erzeugtes Bild" className="mt-3 max-h-[28rem] rounded-md border border-border" />
                      ) : null}
                      {message.citations.length ? (
                        <div className="mt-3 grid gap-2">
                          {message.citations.map((c) => (
                            <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-subtle">
                              <span className="block font-medium">{c.title || hostOf(c.url)}</span>
                              <span className="mt-1 block text-xs text-muted">{hostOf(c.url)}{c.publishedAt ? ` · ${c.publishedAt}` : ""}</span>
                              {c.snippet ? <span className="mt-1 block text-xs text-muted">{c.snippet}</span> : null}
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {message.status === "error" ? <p className="mt-2 text-sm text-danger">{shown}</p> : null}
                    </div>
                  )}
                  <div className="mt-1 flex gap-1">
                    {shown ? (
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 px-1 text-xs text-muted" onClick={() => void navigator.clipboard.writeText(shown)} aria-label="Kopieren">
                        <Copy className="size-3.5" /> Kopieren
                      </button>
                    ) : null}
                    {message.role === "assistant" && shown ? (
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 px-1 text-xs text-muted" onClick={() => void speak(shown)} aria-label="Vorlesen">
                        <Volume2 className="size-3.5" /> Vorlesen
                      </button>
                    ) : null}
                    {message.role === "user" ? (
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1 px-1 text-xs text-muted"
                        onClick={() => {
                          setEditingId(message.id);
                          setDraft(message.content);
                          setFiles([]);
                        }}
                      >
                        <Pencil className="size-3.5" /> Bearbeiten
                      </button>
                    ) : null}
                    {message.role === "assistant" && last && !busy ? (
                      <button type="button" className="inline-flex min-h-9 items-center gap-1 px-1 text-xs text-muted" onClick={() => void send("", { regenerate: true })}>
                        <RefreshCw className="size-3.5" /> Neu
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {learningNote ? (
              <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted">{learningNote}</p>
            ) : null}
            {proposal ? (
              <div className="rounded-lg border border-border bg-card p-3 text-sm">
                <p className="text-muted">Erinnerung bestätigen · {CATEGORY_LABEL[proposal.category]}</p>
                <p className="mt-1 font-medium">{proposal.title}</p>
                <p className="mt-1 text-muted">{proposal.content}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="min-h-10 rounded-md bg-accent px-3 text-sm text-accent-foreground"
                    onClick={() => {
                      void upsertMemory({ data: proposal }).then(() => setProposal(null));
                    }}
                  >
                    Speichern
                  </button>
                  <button type="button" className="min-h-10 px-3 text-sm text-muted" onClick={() => setProposal(null)}>
                    Verwerfen
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="border-t border-border px-3 py-3 sm:px-6"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onPickFiles(e.dataTransfer.files);
          }}
        >
          <div className="mx-auto max-w-3xl">
            {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}
            {busy ? (
              <p className="mb-2 flex items-center gap-2 text-xs text-muted">
                <span className="size-1.5 rounded-full bg-signal" />
                {mode === "research"
                  ? "Recherche schreibt. Die Websuche ist für diesen Modus an."
                  : mode === "analysis"
                    ? "Analyse wird geschrieben."
                    : "Antwort wird geschrieben."}
              </p>
            ) : null}
            {editingId ? (
              <p className="mb-2 text-xs text-muted">Du bearbeitest eine Nachricht. Alles danach wird ersetzt.</p>
            ) : null}
            <div className="mb-2 flex gap-2 overflow-x-auto">
              <select
                aria-label="Modus"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className="min-h-11 shrink-0 rounded-md border border-border bg-card px-2 text-sm"
              >
                {MODES.map((item) => (
                  <option key={item} value={item}>{MODE_LABEL[item]}</option>
                ))}
              </select>
              <select
                aria-label="Modell"
                value={profile?.modelId || "grok-4.5"}
                onChange={(e) => {
                  void saveProfile({ data: { modelId: e.target.value } }).then(() => refreshProfile());
                }}
                className="min-h-11 min-w-0 shrink rounded-md border border-border bg-card px-2 text-sm"
              >
                {(KNOWN_MODELS.some((item) => item.id === (profile?.modelId || "grok-4.5"))
                  ? KNOWN_MODELS
                  : [...KNOWN_MODELS, { id: profile?.modelId || "grok-4.5", label: profile?.modelId || "Modell" }]
                ).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            {files.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((file) => (
                  <span key={file.id} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-1 text-xs">
                    {file.name}
                    <button type="button" aria-label="Anhang entfernen" onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
              <label className="inline-flex size-11 cursor-pointer items-center justify-center text-muted" aria-label="Datei anhängen">
                <Paperclip className="size-4" />
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  accept=".pdf,.docx,.txt,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.md,.json,image/*,text/plain,application/pdf"
                  onChange={(e) => {
                    void onPickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                value={draft}
                rows={1}
                placeholder="Nachricht"
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base outline-none"
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft, { replaceFromMessageId: editingId });
                  }
                }}
              />
              <button
                type="button"
                aria-pressed={forceImage}
                aria-label={forceImage ? "Bilderzeugung an" : "Bilderzeugung"}
                className={`inline-flex size-11 items-center justify-center ${forceImage ? "text-foreground" : "text-muted"}`}
                onClick={() => setForceImage((v) => !v)}
              >
                <ImageIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-pressed={voiceOn}
                aria-label={listening ? "Hört zu" : "Sprache"}
                className={`inline-flex size-11 items-center justify-center ${voiceOn || listening ? "text-foreground" : "text-muted"}`}
                onClick={() => {
                  setVoiceOn(true);
                  toggleMic();
                }}
              >
                <Mic className="size-4" />
              </button>
              {busy ? (
                <button type="button" aria-label="Stopp" className="inline-flex size-11 items-center justify-center rounded-md bg-accent text-accent-foreground" onClick={() => abortRef.current?.abort()}>
                  <Square className="size-4" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Senden"
                  className="inline-flex size-11 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-40"
                  disabled={!draft.trim() && files.length === 0}
                  onClick={() => void send(draft, { replaceFromMessageId: editingId })}
                >
                  <Send className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
