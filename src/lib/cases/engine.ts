import { findConflicts, jaccard } from "../intelligence/engine.ts";

export const REGIONS = ["karlsruhe", "stuttgart", "mannheim", "rastatt", "bw", "de"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  karlsruhe: "Karlsruhe",
  stuttgart: "Stuttgart",
  mannheim: "Mannheim",
  rastatt: "Rastatt",
  bw: "Baden-Württemberg",
  de: "Deutschland",
};

export const EVIDENCE = [
  "official",
  "court",
  "documented",
  "reported",
  "alleged",
  "unconfirmed",
  "hypothesis",
  "speculation",
  "unknown",
] as const;
export type EvidenceClass = (typeof EVIDENCE)[number];

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  official: "Offiziell bestätigt",
  court: "Gerichtlich festgestellt",
  documented: "Dokumentiert",
  reported: "Medial berichtet",
  alleged: "Behauptet",
  unconfirmed: "Unbestätigt",
  hypothesis: "Hypothese",
  speculation: "Spekulation",
  unknown: "Unbekannt",
};

export const SOURCE_KINDS = [
  "police",
  "prosecutor",
  "court",
  "press_release",
  "science",
  "media",
  "social",
  "other",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CASE_TYPES = [
  "homicide",
  "missing",
  "abduction",
  "robbery",
  "burglary",
  "fraud",
  "cyber",
  "arson",
  "assault",
  "sexual",
  "organized",
  "drugs",
  "corruption",
  "economic",
  "unsolved",
  "cold",
  "proceeding",
  "miscarriage",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  homicide: "Tötungsdelikt",
  missing: "Vermisstenfall",
  abduction: "Entführung",
  robbery: "Raub",
  burglary: "Einbruch",
  fraud: "Betrug",
  cyber: "Cybercrime",
  arson: "Brandstiftung",
  assault: "Körperverletzung",
  sexual: "Sexualdelikt",
  organized: "Organisierte Kriminalität",
  drugs: "Drogenkriminalität",
  corruption: "Korruption",
  economic: "Wirtschaftskriminalität",
  unsolved: "Ungeklärt",
  cold: "Cold Case",
  proceeding: "Gerichtsverfahren",
  miscarriage: "Fehlurteil",
};

export const CASE_STATUSES = ["open", "cold", "proceeding", "solved", "historical"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Offen",
  cold: "Cold Case",
  proceeding: "Verfahren",
  solved: "Abgeschlossen laut Quelle",
  historical: "Historisch",
};

export const PERSON_ROLES = ["named", "missing", "convicted", "authority", "witness_public"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export const PERSON_LABEL: Record<PersonRole, string> = {
  named: "Genannt",
  missing: "Vermisst",
  convicted: "Verurteilt",
  authority: "Behörde",
  witness_public: "Öffentlich als Zeuge genannt",
};

export const SOURCE_LABEL: Record<SourceKind, string> = {
  police: "Polizei",
  prosecutor: "Staatsanwaltschaft",
  court: "Gericht",
  press_release: "Pressemitteilung",
  science: "Wissenschaft",
  media: "Medium",
  social: "Soziales Netzwerk",
  other: "Sonstige öffentliche Quelle",
};

export const WORK_KINDS = [
  "scan_region",
  "recheck_source",
  "gap_review",
  "contradiction_scan",
  "cold_review",
  "discovery",
  "benchmark",
  "idle",
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

const REGION_RANK: Record<Region, number> = {
  karlsruhe: 1,
  stuttgart: 2,
  mannheim: 3,
  rastatt: 4,
  bw: 5,
  de: 6,
};

const ABROAD = /\b(ausland|ungarn|frankreich|schweiz|österreich|oesterreich|spanien|polen|italien|niederlande)\b/i;

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

export function isEvidence(value: string): value is EvidenceClass {
  return (EVIDENCE as readonly string[]).includes(value);
}

export function isCaseType(value: string): value is CaseType {
  return (CASE_TYPES as readonly string[]).includes(value);
}

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

export function isPersonRole(value: string): value is PersonRole {
  return (PERSON_ROLES as readonly string[]).includes(value);
}

export function regionRank(region: Region): number {
  return REGION_RANK[region];
}

export function detectRegion(text: string): Region | null {
  const value = text.toLowerCase();
  for (const region of REGIONS) {
    if (region === "bw") {
      if (/baden-württemberg|baden-wuerttemberg|baden württemberg/.test(value)) return "bw";
      continue;
    }
    if (region === "de") {
      if (/\bdeutschland\b|\bgermany\b/.test(value)) return "de";
      continue;
    }
    if (new RegExp(`\\b${region}\\b`).test(value)) return region;
  }
  return null;
}

export function keepForeign(text: string, abroadRelevant: boolean): boolean {
  if (detectRegion(text)) return true;
  if (!abroadRelevant) return false;
  return ABROAD.test(text);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function classifyHost(url: string, title = ""): { kind: SourceKind; evidence: EvidenceClass; note: string } {
  const host = hostOf(url);
  const wire = /^POL[- ]/i.test(title.trim());
  if (/polizei|bka\.de|bundespolizei/.test(host)) {
    return { kind: "police", evidence: "official", note: "Polizeiseite. Nur so weit belegt, wie der abgerufene Text reicht." };
  }
  if (/staatsanwaltschaft|generalbundesanwalt/.test(host)) {
    return { kind: "prosecutor", evidence: "official", note: "Staatsanwaltschaft. Kein Urteil." };
  }
  if (/justiz|gerichtshof|bgh\.de|\bgericht/.test(host)) {
    return { kind: "court", evidence: "court", note: "Gerichtsseite." };
  }
  if (host.endsWith("presseportal.de")) {
    return wire
      ? { kind: "press_release", evidence: "documented", note: "Polizeimeldung über Presseportal. Nicht als unabhängige zweite Quelle zählen." }
      : { kind: "press_release", evidence: "reported", note: "Presseportal. Ursprung noch nicht geprüft." };
  }
  if (/(\.edu|doi\.org|arxiv\.org)/.test(host)) {
    return { kind: "science", evidence: "documented", note: "Wissenschaftliche Quelle. Gilt nur für das, was dort steht." };
  }
  if (/(^|\.)((x|twitter)\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com)$/.test(host)) {
    return { kind: "social", evidence: "alleged", note: "Social Media ist ein Hinweis, kein Beweis." };
  }
  if (host) return { kind: "media", evidence: "reported", note: "Medienbericht, nicht unabhängig geprüft." };
  return { kind: "other", evidence: "unknown", note: "Keine lesbare Quelle." };
}

export function originKey(input: { url: string; title: string; publisher?: string }): string {
  const pm = input.url.match(/\/pm\/(\d+\/\d+)/);
  if (pm) return `pm:${pm[1]}`;
  const stem = input.title.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, " ").trim().slice(0, 80);
  return `${hostOf(input.url)}|${stem}`;
}

export function independentOrigins<T extends { originKey: string }>(rows: T[]): number {
  return new Set(rows.map((row) => row.originKey).filter(Boolean)).size;
}

export function contentHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

export function safePublicUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") return null;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const parts = ipv4.slice(1).map(Number);
      if (parts.some((part) => part > 255)) return null;
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127) return null;
      if (a === 169 && b === 254) return null;
      if (a === 192 && b === 168) return null;
      if (a === 172 && b >= 16 && b <= 31) return null;
    }
    if (host === "::1" || host === "0.0.0.0") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const ACCUSATION = /\b(ist der täter|ist die täterin|eindeutig schuldig|hat die tat begangen|die ki (erkennt|findet) den täter)\b/i;

export function rejectAsFact(text: string, evidence: EvidenceClass): string | null {
  if (evidence === "hypothesis" || evidence === "speculation") {
    if (/\b(feststeht|bewiesen|tatsache ist)\b/i.test(text)) return "Eine Hypothese darf nicht als Tatsache formuliert werden.";
  }
  if (evidence !== "court" && ACCUSATION.test(text)) return "Ohne Gerichtsfeststellung wird niemand als Täter bezeichnet.";
  return null;
}

export function allowPerson(role: PersonRole, evidence: EvidenceClass): string | null {
  if (role === "convicted" && evidence !== "court") return "Verurteilt nur mit gerichtlicher Feststellung.";
  return null;
}

export function personLine(role: PersonRole): string {
  if (role === "convicted") return "In einem Urteil genannt.";
  if (role === "named") return "In einer öffentlichen Quelle genannt. Keine eigene Beschuldigung.";
  if (role === "missing") return "Als vermisst geführt, soweit die Quelle das sagt.";
  if (role === "authority") return "Behörde oder Stelle.";
  if (role === "witness_public") return "Öffentlich als Zeuge genannt. Keine Bewertung der Aussage.";
  return "Unklare Rolle.";
}

export type ContradictionKind = "direct" | "possible" | "apparent" | "none" | "insufficient";

export function classifyContradiction(
  left: { text: string; evidence: EvidenceClass },
  right: { text: string; evidence: EvidenceClass },
): { kind: ContradictionKind; note: string } {
  if (left.text.trim().length < 24 || right.text.trim().length < 24) {
    return { kind: "insufficient", note: "Zu wenig Text für einen Widerspruch." };
  }
  const hit = findConflicts(left.text, [{ id: "r", statement: right.text, status: "current" }]);
  if (!hit.length) {
    if (jaccard(left.text, right.text) >= 0.45) return { kind: "apparent", note: "Ähnlicher Text, aber keine klare Verneinung." };
    return { kind: "none", note: "Kein Widerspruch im Wortlaut." };
  }
  const strong = left.evidence === "official" || left.evidence === "court" || right.evidence === "official" || right.evidence === "court";
  const weak = left.evidence === "reported" || right.evidence === "reported" || left.evidence === "alleged" || right.evidence === "alleged";
  if (strong && !weak) return { kind: "direct", note: "Gegensatz zwischen belastbaren Klassen." };
  if (weak) return { kind: "possible", note: "Mindestens eine Seite ist nur berichtet oder behauptet." };
  return { kind: "possible", note: "Gegensatz, aber die Klassen reichen nicht für einen direkten Widerspruch." };
}

export function timelineGaps(dates: string[], gapDays = 30): string[] {
  const parsed = dates
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => a.time - b.time);
  const notes: string[] = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const days = (parsed[i].time - parsed[i - 1].time) / 86_400_000;
    if (days >= gapDays) notes.push(`${Math.floor(days)} Tage zwischen ${parsed[i - 1].value} und ${parsed[i].value}.`);
  }
  return notes;
}

export function scanFocus(dayIndex: number): "new" | "court" | "missing" {
  const slot = ((Math.floor(dayIndex) % 3) + 3) % 3;
  if (slot === 1) return "court";
  if (slot === 2) return "missing";
  return "new";
}

export function watchDelta(previousHash: string, nextHash: string): { hash: string; changed: boolean; baseline: boolean } {
  if (!previousHash) return { hash: nextHash, changed: false, baseline: true };
  if (previousHash === nextHash) return { hash: nextHash, changed: false, baseline: false };
  return { hash: nextHash, changed: true, baseline: false };
}

export function scanQuery(region: Region, focus: "new" | "court" | "missing"): string {
  const place = REGION_LABEL[region];
  if (focus === "court") return `Gericht ${place} Urteil OR Staatsanwaltschaft ${place}`;
  if (focus === "missing") return `Vermisste ${place} Polizei`;
  if (region === "karlsruhe") return "Polizeipräsidium Karlsruhe Pressemitteilung OR Staatsanwaltschaft Karlsruhe";
  if (region === "stuttgart") return "Polizeipräsidium Stuttgart Pressemitteilung OR Staatsanwaltschaft Stuttgart";
  if (region === "mannheim") return "Polizei Mannheim Pressemitteilung OR Staatsanwaltschaft Mannheim";
  if (region === "rastatt") return "Polizei Rastatt Pressemitteilung OR Polizeipräsidium Karlsruhe Rastatt";
  if (region === "bw") return "Polizei Baden-Württemberg Pressemitteilung";
  return "Polizei Deutschland Pressemitteilung Strafsache";
}

export type DeskSignals = {
  now: Date;
  lastScan: Partial<Record<Region, string>>;
  staleWatches: number;
  casesMissingSource: number;
  hoursSinceContradiction: number | null;
  hoursSinceCold: number | null;
  hoursSinceBenchmark: number | null;
  coldCases: number;
  webAllowed: boolean;
  hoursSinceDiscovery?: number | null;
  comparableCases?: number;
};

export type WorkPlan = {
  kind: WorkKind;
  region: Region | "";
  agent: string;
  reason: string;
  web: boolean;
};

function ageHours(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return (now.getTime() - time) / 3_600_000;
}

export function chooseWork(signals: DeskSignals): WorkPlan {
  const scanGap = 12;
  if (signals.webAllowed) {
    for (const region of REGIONS) {
      const age = ageHours(signals.lastScan[region], signals.now);
      if (age == null || age >= scanGap) {
        return {
          kind: "scan_region",
          region,
          agent: "web_research",
          web: true,
          reason: age == null ? `${REGION_LABEL[region]} wurde noch nicht geprüft.` : `${REGION_LABEL[region]} ist seit ${Math.floor(age)} Stunden nicht geprüft.`,
        };
      }
    }
  }
  if (signals.staleWatches > 0) {
    return {
      kind: "recheck_source",
      region: "",
      agent: "source_hunter",
      web: false,
      reason: `${signals.staleWatches} Quelle(n) sind zur Prüfung fällig. Unveränderte Seiten werden nicht neu analysiert.`,
    };
  }
  if (signals.casesMissingSource > 0) {
    return {
      kind: "gap_review",
      region: "",
      agent: "fact_checker",
      web: false,
      reason: `${signals.casesMissingSource} Fall/Fälle ohne Quelle.`,
    };
  }
  if (signals.coldCases > 0 && (signals.hoursSinceCold == null || signals.hoursSinceCold >= 24)) {
    return {
      kind: "cold_review",
      region: "",
      agent: "cold_case",
      web: false,
      reason: "Gespeicherte Cold Cases strukturieren. Keine neue Beschuldigung.",
    };
  }
  if (signals.hoursSinceContradiction == null || signals.hoursSinceContradiction >= 12) {
    return {
      kind: "contradiction_scan",
      region: "",
      agent: "contradiction",
      web: false,
      reason: "Gespeicherte Aussagen gegeneinander halten.",
    };
  }
  if ((signals.comparableCases ?? 0) >= 2 && (signals.hoursSinceDiscovery == null || signals.hoursSinceDiscovery >= 12)) {
    return {
      kind: "discovery",
      region: "",
      agent: "disconfirmation",
      web: false,
      reason: "Gespeicherte Merkmale vergleichen. Keine Täterfeststellung und keine Websuche.",
    };
  }
  if (signals.hoursSinceBenchmark == null || signals.hoursSinceBenchmark >= 24) {
    return {
      kind: "benchmark",
      region: "",
      agent: "evaluation",
      web: false,
      reason: "Interner Testsatz. Keine Modellanfrage.",
    };
  }
  return {
    kind: "idle",
    region: "",
    agent: "orchestrator",
    web: false,
    reason: "Nichts fällig. Dieselben Seiten werden nicht erneut durchsucht.",
  };
}

export function reviewPublicStatement(text: string): { notes: string[]; refusesDiagnosis: true } {
  const notes: string[] = [];
  if (/\b(einerseits|zuvor|damals)\b/i.test(text) && /\b(später|inzwischen|jetzt)\b/i.test(text)) {
    notes.push("Der Text beschreibt eine zeitliche Änderung. Das ist keine Lügenfeststellung.");
  }
  if (/\b(nicht|kein)\b/i.test(text) && /\b(doch|bereits|schon)\b/i.test(text)) {
    notes.push("Es gibt gegensätzliche Formulierungen. Alternative Erklärungen bleiben offen.");
  }
  if (!notes.length) notes.push("Keine auffällige Formulierung. Keine Bewertung der Person.");
  return { notes, refusesDiagnosis: true };
}

export function similarityNote(sharedType: boolean, sharedPlace: boolean, proven: boolean): string {
  if (proven) return "Verbindung ist nur gesetzt, weil sie ausdrücklich als belegt markiert wurde.";
  if (sharedType && sharedPlace) return "Ähnlichkeit: gleicher Typ und Ort. Das ist kein belegter Zusammenhang.";
  if (sharedType || sharedPlace) return "Ein gemeinsames Merkmal. Kein Zusammenhang.";
  return "Keine gemeinsame Merkmalsbasis.";
}

export type CitationHit = { url: string; title?: string; snippet?: string };

export function leadsFromCitations(
  hits: CitationHit[],
): { kept: Array<CitationHit & { region: Region; evidence: EvidenceClass; kind: SourceKind; originKey: string; note: string }>; dropped: number } {
  const kept = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const hit of hits) {
    const url = safePublicUrl(hit.url);
    const blob = `${hit.title ?? ""} ${hit.snippet ?? ""} ${hit.url}`;
    const region = detectRegion(blob);
    if (!url || !region) {
      dropped += 1;
      continue;
    }
    const classified = classifyHost(url, hit.title ?? "");
    const key = originKey({ url, title: hit.title ?? "" });
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    kept.push({ ...hit, url, region, evidence: classified.evidence, kind: classified.kind, originKey: key, note: classified.note });
  }
  return { kept, dropped };
}

export const SEED_WATCHES: { url: string; title: string; region: Region }[] = [
  { url: "https://ppkarlsruhe.polizei-bw.de/", title: "Polizeipräsidium Karlsruhe", region: "karlsruhe" },
  { url: "https://www.presseportal.de/blaulicht/nr/110972", title: "Presseportal Polizeipräsidium Karlsruhe", region: "karlsruhe" },
  { url: "https://ppstuttgart.polizei-bw.de/", title: "Polizeipräsidium Stuttgart", region: "stuttgart" },
  { url: "https://www.polizei-bw.de/", title: "Polizei Baden-Württemberg", region: "bw" },
];
