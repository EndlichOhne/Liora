export const MODES = ["normal", "think", "research", "code", "writing", "analysis"] as const;
export type Mode = (typeof MODES)[number];

export const MEMORY_CATEGORIES = [
  "personal",
  "preference",
  "project",
  "fact",
  "event",
  "knowledge",
  "instruction",
  "long_term",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CONFIDENCE = ["", "low", "medium", "high"] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCE)[number];

export const MEMORY_STATUSES = ["active", "verified"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const RESPONSE_STYLES = ["concise", "balanced", "thorough"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const VOICES = ["eve", "ara", "rex", "sal"] as const;

export const KNOWN_MODELS = [
  { id: "grok-4.5", label: "Grok 4.5" },
  { id: "grok-4", label: "Grok 4" },
  { id: "grok-3", label: "Grok 3" },
] as const;

export type Citation = {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
};

export type AttachmentRef = {
  id: string;
  name: string;
  mime: string;
  kind: string;
};

export type MessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  citations: Citation[];
  attachments: AttachmentRef[];
  imageData: string | null;
  status: "streaming" | "complete" | "error" | "stopped";
  createdAt: string;
};

export type ConversationDTO = {
  id: string;
  title: string;
  mode: Mode;
  projectId: string | null;
  updatedAt: string;
};

export type ProfileDTO = {
  displayName: string;
  language: "de" | "en";
  writingNotes: string;
  responseStyle: ResponseStyle;
  theme: ThemeChoice;
  modelId: string;
  voiceId: string;
  voiceAuto: boolean;
  email: string | null;
  hasPassword: boolean;
};

export type MemoryDTO = {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  source: string;
  confidence: MemoryConfidence;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
};

export type ProjectDTO = {
  id: string;
  name: string;
  summary: string;
  contextNotes: string;
  updatedAt: string;
};

export type TaskDTO = { id: string; title: string; done: boolean };
export type NoteDTO = { id: string; title: string; body: string; updatedAt: string };

export type FileDTO = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  kind: string;
  excerpt: string;
  projectId: string | null;
  createdAt: string;
  imageData: string | null;
};

export type MemoryProposal = {
  category: MemoryCategory;
  title: string;
  content: string;
};

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

export function isMemoryConfidence(value: string): value is MemoryConfidence {
  return (MEMORY_CONFIDENCE as readonly string[]).includes(value);
}

export function visibleContent(content: string): string {
  const start = content.indexOf(":::memory");
  if (start === -1) return content;
  const end = content.indexOf(":::", start + ":::memory".length);
  if (end === -1) return content.slice(0, start).trimEnd();
  return (content.slice(0, start) + content.slice(end + 3)).trim();
}

export function extractMemory(content: string): { text: string; proposal: MemoryProposal | null } {
  const start = content.indexOf(":::memory");
  if (start === -1) return { text: content.trim(), proposal: null };
  const end = content.indexOf(":::", start + ":::memory".length);
  if (end === -1) return { text: content.trim(), proposal: null };
  const raw = content.slice(start + ":::memory".length, end).trim();
  const text = (content.slice(0, start) + content.slice(end + 3)).trim();
  try {
    const parsed = JSON.parse(raw) as { category?: string; title?: string; content?: string };
    if (!parsed.category || !isMemoryCategory(parsed.category)) return { text, proposal: null };
    const title = (parsed.title ?? "").trim().slice(0, 140);
    const body = (parsed.content ?? "").trim().slice(0, 4000);
    if (!title || !body) return { text, proposal: null };
    return { text, proposal: { category: parsed.category, title, content: body } };
  } catch {
    return { text, proposal: null };
  }
}

export function applyTheme(theme: ThemeChoice) {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("liora-theme", theme);
  } catch {
    /* ignore */
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const MODE_LABEL: Record<Mode, string> = {
  normal: "Normal",
  think: "Denken",
  research: "Recherche",
  code: "Code",
  writing: "Schreiben",
  analysis: "Analyse",
};

export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  personal: "Persönlich",
  preference: "Präferenzen",
  project: "Projekte",
  fact: "Fakten",
  event: "Ereignisse",
  knowledge: "Wissen",
  instruction: "Anweisungen",
  long_term: "Persönlich",
};

export const CONFIDENCE_LABEL: Record<MemoryConfidence, string> = {
  "": "Nicht gesetzt",
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
};

export const MEMORY_STATUS_LABEL: Record<MemoryStatus, string> = {
  active: "Offen",
  verified: "Geprüft",
};

export const MEMORY_SECTIONS: { id: MemoryCategory; label: string; match: MemoryCategory[] }[] = [
  { id: "personal", label: "Persönlich", match: ["personal", "long_term"] },
  { id: "preference", label: "Präferenzen", match: ["preference"] },
  { id: "project", label: "Projekte", match: ["project"] },
  { id: "fact", label: "Fakten", match: ["fact"] },
  { id: "event", label: "Ereignisse", match: ["event"] },
  { id: "knowledge", label: "Wissen", match: ["knowledge"] },
  { id: "instruction", label: "Anweisungen", match: ["instruction"] },
];
