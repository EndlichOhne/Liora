export const RESEARCH_SCOPES = ["karlsruhe", "stuttgart", "mannheim", "rastatt", "bw", "de", "custom"] as const;
export type ResearchScope = (typeof RESEARCH_SCOPES)[number];

export const RESEARCH_STATUSES = ["queued", "running", "completed", "failed", "paused"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const ELEMENT_STATUSES = ["fact", "claim", "question", "hypothesis", "unknown"] as const;
export type ElementStatus = (typeof ELEMENT_STATUSES)[number];

export const INDEPENDENCE = ["independent", "derived", "copied", "unknown"] as const;
export type IndependenceStatus = (typeof INDEPENDENCE)[number];

export type ResearchStep = { name: string; note: string; status: "done" | "skipped" };

export type ResearchElement = {
  kind: string;
  rawValue: string;
  normalizedValue: string;
  normalizationMethod: string;
  status: ElementStatus;
  polarity: "positive" | "negative" | "unknown";
  confidence: "unverified";
};

export type PriorTask = {
  id: string;
  sessionId: string;
  caseId: string | null;
  normalized: string;
  status: string;
  updatedAt: string;
  scope: string;
};

const CITIES: { name: string; scope: ResearchScope }[] = [
  { name: "Karlsruhe", scope: "karlsruhe" },
  { name: "Stuttgart", scope: "stuttgart" },
  { name: "Mannheim", scope: "mannheim" },
  { name: "Rastatt", scope: "rastatt" },
];

export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeRequest(raw: string): string {
  return normalizeText(raw).slice(0, 500);
}

export function normalizeValue(raw: string): { rawValue: string; normalizedValue: string; normalizationMethod: string } {
  const clock = clockOf(raw);
  if (clock) return { rawValue: raw, normalizedValue: clock, normalizationMethod: "clock-hhmm" };
  const folded = normalizeText(raw);
  if (/^mercedes\s+benz$/.test(folded)) {
    return { rawValue: raw, normalizedValue: "mercedes benz", normalizationMethod: "brand-fold" };
  }
  return { rawValue: raw, normalizedValue: folded, normalizationMethod: "fold-v1" };
}

export function clockOf(raw: string): string | null {
  const text = raw.trim();
  const words = text.match(/\b(?:um\s+)?([01]?\d|2[0-3])\s*uhr\s*([0-5]\d)\b/i);
  if (words) return `${words[1].padStart(2, "0")}:${words[2]}`;
  const colon = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colon) return `${colon[1].padStart(2, "0")}:${colon[2]}`;
  const dotted = text.match(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*uhr\b/i);
  if (dotted) return `${dotted[1].padStart(2, "0")}:${dotted[2]}`;
  return null;
}

export function isFollowUp(text: string): boolean {
  return /\b(such(?:e)? noch|recherchiere weiter|jetzt ganz|noch nach|auch nach)\b/i.test(text);
}

export function detectScope(text: string): ResearchScope {
  if (/ganz deutschland|bundesweit|\bdeutschland\b/i.test(text)) return "de";
  if (/baden-württemberg|baden wuerttemberg|\bbw\b/i.test(text)) return "bw";
  for (const city of CITIES) {
    if (text.toLowerCase().includes(city.name.toLowerCase())) return city.scope;
  }
  return "custom";
}

export function scopeFor(text: string, followUp: boolean, previousScope: string | null): ResearchScope {
  const named = /ganz deutschland|bundesweit|\bdeutschland\b|baden-württemberg|baden wuerttemberg|\bbw\b|karlsruhe|stuttgart|mannheim|rastatt/i.test(text);
  if (followUp && !named && previousScope && RESEARCH_SCOPES.includes(previousScope as ResearchScope)) {
    return previousScope as ResearchScope;
  }
  return detectScope(text);
}

export function isDuplicateRequest(previous: { normalized: string; status: string }[], normalized: string, followUp: boolean): boolean {
  if (followUp || !normalized) return false;
  return previous.some((row) => row.normalized === normalized && (row.status === "completed" || row.status === "running" || row.status === "paused"));
}

export function sessionFor(previous: PriorTask[], followUp: boolean, caseId: string | null): string | null {
  if (!followUp || previous.length === 0) return null;
  const sameCase = caseId ? previous.filter((row) => row.caseId === caseId) : [];
  const pool = sameCase.length ? sameCase : previous;
  const sorted = [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sorted[0]?.sessionId ?? null;
}

export function buildPlan(text: string, scope: ResearchScope, web: boolean, caseId: string | null): ResearchStep[] {
  const steps: ResearchStep[] = [
    {
      name: "Fall im Bestand suchen",
      note: caseId ? "Akte ist gewählt. Es wird nichts Neues erfunden." : "Keine Akte gewählt. Nur der Text der Anfrage.",
      status: "done",
    },
    {
      name: "Anfrage zerlegen",
      note: "Orte, Zeiten und Begriffe werden gelesen und als ungeprüft gespeichert, nicht als Fakt.",
      status: "done",
    },
  ];
  if (/vergleich|anderen fällen|anderen faellen|cross/i.test(text)) {
    steps.push({
      name: "Gespeicherte Merkmale vergleichen",
      note: "Nur der eigene Bestand. Keine Täterfeststellung.",
      status: "done",
    });
  } else {
    steps.push({
      name: "Gespeicherte Merkmale vergleichen",
      note: "Ein Vergleich läuft nur, wenn schon mindestens zwei Akten Merkmale haben.",
      status: "done",
    });
  }
  if (/fahrzeug|auto|kennzeichen|mercedes/i.test(text)) {
    steps.push({
      name: "Fahrzeugangaben im Bestand suchen",
      note: "Fehlt das Fahrzeug, bleibt die Frage offen.",
      status: "done",
    });
  }
  steps.push({
    name: scope === "de" ? "Gebiet Deutschland" : `Gebiet ${scope}`,
    note: "Das Gebiet engt die Anfrage ein. Es erzeugt keine Treffer.",
    status: "done",
  });
  steps.push({
    name: "Öffentliche Suche",
    note: web ? "Nur wenn die Suche wirklich Quellen zurückgibt, werden sie gespeichert." : "Websuche nicht freigegeben.",
    status: web ? "done" : "skipped",
  });
  steps.push({
    name: "Lücken und Gegenbeispiele",
    note: "Offene Fragen kommen nur aus fehlenden gespeicherten Angaben.",
    status: "done",
  });
  return steps;
}

export function scanRequest(text: string): ResearchElement[] {
  const found: ResearchElement[] = [];
  const push = (kind: string, raw: string, status: ElementStatus, polarity: ResearchElement["polarity"] = "unknown") => {
    const norm = normalizeValue(raw);
    if (!norm.normalizedValue) return;
    if (found.some((item) => item.kind === kind && item.normalizedValue === norm.normalizedValue && item.polarity === polarity)) return;
    found.push({
      kind,
      rawValue: norm.rawValue.slice(0, 180),
      normalizedValue: norm.normalizedValue.slice(0, 180),
      normalizationMethod: norm.normalizationMethod,
      status,
      polarity,
      confidence: "unverified",
    });
  };

  for (const city of CITIES) {
    if (text.toLowerCase().includes(city.name.toLowerCase())) push("city", city.name, "unknown");
  }
  if (/\bdeutschland\b/i.test(text)) push("country", "Deutschland", "unknown");
  const scope = detectScope(text);
  push("scope", scope, "unknown");

  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) push("date", match[0], "unknown");
  for (const match of text.matchAll(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/g)) push("date", match[0], "unknown");
  const clock = clockOf(text);
  if (clock) push("time", clock, "unknown");

  if (/kein(?:e|en)?\s+fahrzeug|fahrzeug\s+(?:ausgeschlossen|verneint)|ohne\s+fahrzeug/i.test(text)) {
    push("vehicle", "Fahrzeug", "claim", "negative");
  } else if (/fahrzeug|kennzeichen|mercedes/i.test(text)) {
    const brand = text.match(/mercedes[-\s]?benz/i);
    push("vehicle", brand ? brand[0] : "Fahrzeug", "unknown", "positive");
  }

  if (/\b(polizei|staatsanwaltschaft|gericht)\b/i.test(text)) {
    const hit = text.match(/\b(polizei|staatsanwaltschaft|gericht)\b/i);
    if (hit) push("authority", hit[1], "unknown");
  }

  if (/\bvielleicht\b|\bmöglich\b|\bmoeglich\b|\bhypothese\b/i.test(text)) {
    push("hypothesis", text.slice(0, 160), "hypothesis");
  }
  if (/\bbehauptet\b/i.test(text)) push("claim", text.slice(0, 160), "claim");
  if (text.includes("?")) push("question", text.slice(0, 160), "question");

  const labeled = text.match(/\bPerson:\s*([^,.\n]{2,80})/);
  if (labeled && !/\btäter\b|\btaeter\b/i.test(text)) push("person", labeled[1].trim(), "unknown");

  return found.filter((item) => item.status !== "fact");
}

export function familyKey(url: string, title: string): string {
  const pm = url.match(/\/pm\/(\d+\/\d+)/);
  if (pm) return `pm:${pm[1]}`;
  return normalizeText(title).slice(0, 80);
}

export function markIndependence<T extends { id: string; url: string; title: string; note?: string }>(rows: T[]): Array<T & { independenceStatus: IndependenceStatus; sourceFamilyId: string; parentSourceId: string }> {
  const first = new Map<string, string>();
  return rows.map((row) => {
    const key = familyKey(row.url, row.title || row.note || "");
    if (!key) {
      return { ...row, independenceStatus: "unknown", sourceFamilyId: "", parentSourceId: "" };
    }
    const parent = first.get(key);
    if (!parent) {
      first.set(key, row.id);
      const derived = /übernimmt|uebernimmt|laut polizei|dpa|nachrichtlich/i.test(`${row.title} ${row.note ?? ""}`);
      return {
        ...row,
        independenceStatus: derived ? "derived" : "independent",
        sourceFamilyId: row.id,
        parentSourceId: "",
      };
    }
    return { ...row, independenceStatus: "copied", sourceFamilyId: parent, parentSourceId: parent };
  });
}

export function independentCount(rows: { independenceStatus: IndependenceStatus }[]): number {
  return rows.filter((row) => row.independenceStatus === "independent").length;
}

export type StoredEvent = { occurredOn: string; label: string; detail: string; sourceUrl: string; place?: string };

export function timelineFromEvents(caseId: string, events: StoredEvent[]) {
  return events.map((event) => {
    const clock = clockOf(`${event.occurredOn} ${event.label} ${event.detail}`);
    return {
      caseId,
      date: event.occurredOn.trim() ? event.occurredOn : "DATE MISSING",
      time: clock || "TIME MISSING",
      location: event.place?.trim() || "LOCATION MISSING",
      event: event.label || "Ereignis ohne Bezeichnung",
      sourceId: event.sourceUrl.trim() ? event.sourceUrl : "SOURCE MISSING",
    };
  });
}

export function openQuestions(input: {
  events: StoredEvent[];
  hasCourtSource: boolean;
  hasVehicle: boolean;
  askedVehicle: boolean;
  askedCourt: boolean;
  askedTime: boolean;
}): { question: string; priority: "low" | "medium" | "high" }[] {
  const questions: { question: string; priority: "low" | "medium" | "high" }[] = [];
  for (const event of input.events) {
    if (!event.occurredOn.trim()) questions.push({ question: `DATE MISSING: ${event.label || "Ereignis"}`, priority: "high" });
    if (!event.sourceUrl.trim()) questions.push({ question: `SOURCE MISSING: ${event.label || "Ereignis"}`, priority: "medium" });
  }
  if (input.askedTime && !input.events.some((event) => clockOf(`${event.occurredOn} ${event.label} ${event.detail}`))) {
    questions.push({ question: "TIME MISSING", priority: "medium" });
  }
  if (input.askedVehicle && !input.hasVehicle) questions.push({ question: "VEHICLE INFORMATION MISSING", priority: "medium" });
  if (input.askedCourt && !input.hasCourtSource) questions.push({ question: "COURT SOURCE MISSING", priority: "medium" });
  if (input.events.length && input.events.every((event) => !event.place?.trim())) {
    questions.push({ question: "LOCATION MISSING", priority: "low" });
  }
  const seen = new Set<string>();
  return questions.filter((item) => (seen.has(item.question) ? false : (seen.add(item.question), true)));
}

export function datasetCountLabel(matching: number, total: number): string {
  if (!Number.isInteger(matching) || !Number.isInteger(total) || total < 1 || matching < 0 || matching > total) {
    return "INSUFFICIENT DATA";
  }
  return `${matching} von ${total} analysierten Fällen in diesem Bestand. Keine Aussage über alle deutschen Fälle.`;
}

export function reevaluateDecision(beforeFingerprint: string, afterFingerprint: string): "NO NEW DATA" | "neu bewertet" {
  if (beforeFingerprint && beforeFingerprint === afterFingerprint) return "NO NEW DATA";
  return "neu bewertet";
}

export function nextStatus(current: ResearchStatus, event: "start" | "finish" | "fail" | "pause" | "resume"): ResearchStatus {
  if (event === "start" && (current === "queued" || current === "paused")) return "running";
  if (event === "finish" && current === "running") return "completed";
  if (event === "fail" && (current === "running" || current === "queued")) return "failed";
  if (event === "pause" && current === "running") return "paused";
  if (event === "resume" && current === "paused") return "running";
  return current;
}

export function priorityFor(text: string): "low" | "medium" | "high" {
  if (/eilt|sofort|dringend|kritisch/i.test(text)) return "high";
  if (/irgendwann|niedrig|später|spaeter/i.test(text)) return "low";
  return "medium";
}

export function titleFromRequest(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 80) || "Recherche";
}
