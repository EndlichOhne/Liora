import { jaccard } from "../intelligence/engine.ts";
import {
  REGION_LABEL,
  REGIONS,
  rejectAsFact,
  type CaseStatus,
  type CaseType,
  type EvidenceClass,
  type Region,
  type SourceKind,
} from "./engine.ts";

/**
 * Turns a real public citation into a case candidate.
 * It never invents a case, a date, a city, or a perpetrator.
 */

export const CANDIDATE_STATUSES = ["candidate", "verified_public", "duplicate", "rejected", "needs_review"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const NONE_FOUND = "Keine neuen öffentlichen Fälle gefunden.";

const INCIDENT =
  /\b(festnahme|raub|raubüberfall|mord|totschlag|leiche|brandstiftung|brand|vermisst|vermisstenfahndung|urteil|anklage|ermittlung|ermittlungen|schuss|überfall|ueberfall|diebstahl|einbruch|fahndung|tatverdächtig|tatverdaechtig|verurteilt|straftat|tötung|toetung|körperverletzung|koerperverletzung|unfall|explosion|geiselnahme|sexualdelikt|vergewaltigung|entführung|entfuehrung)\b/i;

const BANNED = /polizei\s+(weiß|weiss)\s+(das|es)\s+nicht|täter\s+gefunden|denselben\s+täter|ist der täter|ist die täterin/i;

export type PublicHit = {
  url: string;
  title: string;
  snippet: string;
  region: Region;
  evidence: EvidenceClass;
  kind: SourceKind;
  originKey: string;
};

export type CaseDraft = {
  title: string;
  region: Region;
  city: string;
  caseType: CaseType;
  caseStatus: CaseStatus;
  openedOn: string;
  summary: string;
  sourceUrl: string;
  originKey: string;
  evidence: EvidenceClass;
  kind: SourceKind;
  confidence: "low" | "limited" | "notable";
  status: "candidate" | "needs_review";
  missing: string[];
  adoptable: boolean;
};

export type KnownRecord = {
  id: string;
  kind: "case" | "candidate";
  title: string;
  city: string;
  openedOn: string;
  caseType: string;
  sourceUrls: string[];
  originKeys: string[];
};

export function foldTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function validIso(year: string, month: string, day: string): string {
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10) === iso ? iso : "";
}

export function dateFromText(text: string): string {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const found = validIso(iso[1], iso[2], iso[3]);
    if (found) return found;
  }
  const german = text.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (!german) return "";
  return validIso(german[3], german[2], german[1]);
}

function caseTypeOf(text: string, evidence: EvidenceClass): CaseType {
  if (/vermisst/.test(text)) return "missing";
  if (/entführ|entfuehr|geisel/.test(text)) return "abduction";
  if (/raub|überfall|ueberfall/.test(text)) return "robbery";
  if (/einbruch/.test(text)) return "burglary";
  if (/brand/.test(text)) return "arson";
  if (/körperverletzung|koerperverletzung/.test(text)) return "assault";
  if (/sexual|vergewalt/.test(text)) return "sexual";
  if (/mord|totschlag|tötung|toetung|leiche/.test(text)) return "homicide";
  if (/betrug/.test(text)) return "fraud";
  if (/cyber|phishing/.test(text)) return "cyber";
  if (evidence === "court" && /urteil|anklage|prozess/.test(text)) return "proceeding";
  return "unsolved";
}

function caseStatusOf(text: string, evidence: EvidenceClass, caseType: CaseType): CaseStatus {
  if (evidence === "court" && /verurteilt|rechtskräftig|rechtskraeftig/.test(text)) return "solved";
  if (caseType === "proceeding" || (evidence === "court" && /urteil|anklage|prozess/.test(text))) return "proceeding";
  return "open";
}

function strongEvidence(evidence: EvidenceClass): boolean {
  return evidence === "official" || evidence === "court" || evidence === "documented";
}

export function draftFromHit(hit: PublicHit): CaseDraft | null {
  const title = hit.title.replace(/\s+/g, " ").trim();
  const snippet = hit.snippet.replace(/\s+/g, " ").trim();
  const blob = `${title} ${snippet}`.toLowerCase();
  if (!title || title.length < 8) return null;
  if (!INCIDENT.test(blob)) return null;
  if (BANNED.test(blob) || rejectAsFact(`${title} ${snippet}`, hit.evidence)) return null;
  const openedOn = dateFromText(`${title} ${snippet}`);
  const city = hit.region === "bw" || hit.region === "de" ? "" : REGION_LABEL[hit.region];
  const missing = [openedOn ? "" : "DATE MISSING", city ? "" : "CITY MISSING"].filter(Boolean);
  const caseType = caseTypeOf(blob, hit.evidence);
  const adoptable = strongEvidence(hit.evidence);
  return {
    title: title.slice(0, 180),
    region: hit.region,
    city,
    caseType,
    caseStatus: caseStatusOf(blob, hit.evidence, caseType),
    openedOn,
    summary: (snippet || title).slice(0, 1000),
    sourceUrl: hit.url,
    originKey: hit.originKey,
    evidence: hit.evidence,
    kind: hit.kind,
    confidence: adoptable ? (openedOn ? "notable" : "limited") : "low",
    status: adoptable ? "candidate" : "needs_review",
    missing,
    adoptable,
  };
}

export function matchDuplicate(draft: Pick<CaseDraft, "title" | "city" | "openedOn" | "caseType" | "sourceUrl" | "originKey">, known: KnownRecord[]): { id: string; kind: "case" | "candidate"; reason: string } | null {
  const title = foldTitle(draft.title);
  for (const row of known) {
    if (draft.originKey && row.originKeys.includes(draft.originKey)) return { id: row.id, kind: row.kind, reason: "gleiche Herkunft" };
    if (draft.sourceUrl && row.sourceUrls.includes(draft.sourceUrl)) return { id: row.id, kind: row.kind, reason: "gleiche Quelle" };
    if (title && title === foldTitle(row.title)) return { id: row.id, kind: row.kind, reason: "gleicher Titel" };
    if (jaccard(draft.title, row.title) >= 0.42) return { id: row.id, kind: row.kind, reason: "ähnliche Schreibweise" };
    const samePlace = Boolean(draft.city) && foldTitle(draft.city) === foldTitle(row.city);
    const sameDate = Boolean(draft.openedOn) && draft.openedOn === row.openedOn;
    const sameType = Boolean(draft.caseType) && draft.caseType === row.caseType && draft.caseType !== "unsolved";
    if (samePlace && sameDate && sameType && jaccard(draft.title, row.title) >= 0.2) {
      return { id: row.id, kind: row.kind, reason: "gleicher Ort, gleiches Datum und gleicher Falltyp" };
    }
  }
  return null;
}

export function researchOutcome(input: { citations: number; adopted: number; waiting: number; duplicates: number }): string {
  if (input.citations < 1 || (input.adopted === 0 && input.waiting === 0)) return NONE_FOUND;
  const parts: string[] = [];
  if (input.adopted) parts.push(`${input.adopted} in die Fallbank übernommen`);
  if (input.waiting) parts.push(`${input.waiting} zur Prüfung`);
  if (input.duplicates) parts.push(`${input.duplicates} Dubletten`);
  return `${parts.join(", ")}. Nichts erfunden.`;
}

export function nextScanRegion(lastScan: Partial<Record<Region, string>>, now = new Date()): Region {
  let best: Region = "karlsruhe";
  let bestAge = -1;
  for (const region of REGIONS) {
    const stamp = lastScan[region];
    const time = stamp ? Date.parse(stamp) : Number.NaN;
    const age = Number.isNaN(time) ? Number.POSITIVE_INFINITY : (now.getTime() - time) / 3_600_000;
    if (age > bestAge) {
      best = region;
      bestAge = age;
    }
  }
  return best;
}
