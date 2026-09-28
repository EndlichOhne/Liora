import { foldTitle, dateFromText } from "../cases/intake.ts";
import { jaccard } from "../intelligence/engine.ts";
import {
  isEvidence,
  isRegion,
  rejectAsFact,
  safePublicUrl,
  type EvidenceClass,
  type Region,
} from "../cases/engine.ts";

/**
 * Rules for a public person file.
 * A pattern is never a person, and a name match is never a merge by itself.
 */

export const PEOPLE_ROLES = [
  "convicted",
  "wanted_public",
  "missing",
  "historical",
  "publicly_named",
  "witness_public",
  "authority",
] as const;
export type PeopleRole = (typeof PEOPLE_ROLES)[number];

export const PEOPLE_STATUSES = ["needs_review", "partially_verified", "verified_public", "outdated", "conflicting"] as const;
export type PeopleStatus = (typeof PEOPLE_STATUSES)[number];

export const CASE_RELATIONS = [
  "convicted_in",
  "wanted_in",
  "missing_from",
  "named_in",
  "witness_in",
  "authority_in",
  "mentioned_in",
] as const;
export type CaseRelation = (typeof CASE_RELATIONS)[number];

export const SOURCE_RELATIONS = ["identifies", "supports_role", "mentions"] as const;
export type SourceRelation = (typeof SOURCE_RELATIONS)[number];

export const ROLE_LABEL: Record<PeopleRole, string> = {
  convicted: "Verurteilt",
  wanted_public: "Öffentlich zur Fahndung ausgeschrieben",
  missing: "Vermisst",
  historical: "Historische Person",
  publicly_named: "Öffentlich genannt",
  witness_public: "Öffentlich als Zeuge genannt",
  authority: "Behörde oder Amtsperson",
};

export const PEOPLE_STATUS_LABEL: Record<PeopleStatus, string> = {
  needs_review: "Zur Prüfung",
  partially_verified: "Teilweise belegt",
  verified_public: "Öffentlich belegt",
  outdated: "Veraltet markiert",
  conflicting: "Widerspruch",
};

export const RELATION_LABEL: Record<CaseRelation, string> = {
  convicted_in: "Im Urteil zu diesem Fall genannt",
  wanted_in: "In der öffentlichen Fahndung zu diesem Fall genannt",
  missing_from: "In diesem Vermisstenfall genannt",
  named_in: "In diesem Fall öffentlich genannt",
  witness_in: "In diesem Fall öffentlich als Zeuge genannt",
  authority_in: "Als Behörde oder Amtsperson zu diesem Fall genannt",
  mentioned_in: "In einer öffentlichen Quelle zu diesem Fall erwähnt",
};

export const NOT_A_PATTERN = "Eine Person wird nicht allein aufgrund eines KI-Musters einer Rolle zugeordnet.";
export const NO_EVALUATION = "Solche Bewertungen werden nicht gespeichert. Nur belegbare Angaben.";
export const CONVICTED_ONLY = "Verurteilt nur mit gerichtlicher Feststellung.";
export const WANTED_ONLY = "Öffentlich zur Fahndung ausgeschrieben nur mit behördlicher oder dokumentierter Quelle.";
export const NEEDS_SOURCE = "Eine Person braucht eine öffentliche https-Quelle.";
export const RELATION_NEEDS_SOURCE = "Jede Beziehung braucht eine Quelle.";
export const OTHER_ACCOUNT = "Diese Akte gehört einem anderen Konto.";
export const NOT_SIGNED_IN = "Nicht angemeldet.";
export const NOT_DOCUMENTED = "Unbelegte oder nur behauptete Angaben werden nicht als Personenrolle gespeichert.";
export const NOT_VERIFIED = "Noch nicht ausreichend belegt. Ein Medienbericht wird nicht zur öffentlichen Feststellung.";
export const SAME_NAME = "Gleicher Name, keine zusätzlichen übereinstimmenden Merkmale. Nicht zusammengeführt.";
export const POSSIBLE_DUPLICATE = "Mögliche Dublette. Nicht zusammengeführt. Menschliche Prüfung nötig.";
export const NONE_PEOPLE = "Keine Personen gefunden.";
export const LINK_NOTE = "Diese Information ist in den geprüften Daten miteinander verknüpft.";
export const CONFLICT_NOTE = "Die Quellen widersprechen sich. Es wird keine Angabe ausgewählt.";
export const PRIVATE_DATA = "Private Adressen, Telefonnummern und private Kontaktdaten werden nicht gespeichert.";
export const VERIFIED_MEANS = "Öffentlich belegt heißt nur: die Angabe ist durch geprüfte öffentliche Quellen dokumentiert. Das ist keine Schuldfeststellung.";
export const WEAK_CLASS = "Eine Hypothese oder eine leere Klasse trägt keine Personenrolle.";

const JUDGMENT =
  /\b(gefährlich|gefaehrlich|schlimmster verbrecher|wahrscheinlicher täter|wahrscheinlicher taeter|wahrscheinlichster täter|wahrscheinlichster taeter|ki-muster|mustererkennung als täter)\b/i;

const STRONG = new Set<EvidenceClass>(["official", "court", "documented"]);
const PUBLIC = new Set<EvidenceClass>(["official", "court", "documented", "reported"]);

export function normalizeName(value: string): string {
  return foldTitle(value);
}

export function isPeopleRole(value: string): value is PeopleRole {
  return (PEOPLE_ROLES as readonly string[]).includes(value);
}

export function isPeopleStatus(value: string): value is PeopleStatus {
  return (PEOPLE_STATUSES as readonly string[]).includes(value);
}

export function isCaseRelation(value: string): value is CaseRelation {
  return (CASE_RELATIONS as readonly string[]).includes(value);
}

export function isSourceRelation(value: string): value is SourceRelation {
  return (SOURCE_RELATIONS as readonly string[]).includes(value);
}

export function caseMentionRole(role: PeopleRole): "named" | "missing" | "convicted" | "authority" | "witness_public" {
  if (role === "missing") return "missing";
  if (role === "convicted") return "convicted";
  if (role === "authority") return "authority";
  if (role === "witness_public") return "witness_public";
  return "named";
}

export function relationForRole(role: PeopleRole): CaseRelation {
  if (role === "convicted") return "convicted_in";
  if (role === "wanted_public") return "wanted_in";
  if (role === "missing") return "missing_from";
  if (role === "witness_public") return "witness_in";
  if (role === "authority") return "authority_in";
  if (role === "historical") return "mentioned_in";
  return "named_in";
}

export function missingNotes(input: { birthYear: number | null; nationality: string | null; region: string | null }): string[] {
  return [
    input.birthYear == null ? "BIRTH YEAR MISSING" : "",
    input.nationality ? "" : "NATIONALITY MISSING",
    input.region ? "" : "REGION MISSING",
  ].filter(Boolean);
}

function judgment(text: string): string | null {
  if (JUDGMENT.test(text)) return NO_EVALUATION;
  return null;
}

function classForRole(role: PeopleRole, evidence: EvidenceClass): string | null {
  if (evidence === "hypothesis" || evidence === "speculation" || evidence === "unknown") return WEAK_CLASS;
  if (!PUBLIC.has(evidence)) return NOT_DOCUMENTED;
  if (role === "convicted" && evidence !== "court") return CONVICTED_ONLY;
  if (role === "wanted_public" && !STRONG.has(evidence)) return WANTED_ONLY;
  return null;
}

function classForRelation(relation: CaseRelation, evidence: EvidenceClass): string | null {
  if (evidence === "hypothesis" || evidence === "speculation" || evidence === "unknown") return WEAK_CLASS;
  if (!PUBLIC.has(evidence)) return NOT_DOCUMENTED;
  if (relation === "convicted_in" && evidence !== "court") return CONVICTED_ONLY;
  if (relation === "wanted_in" && !STRONG.has(evidence)) return WANTED_ONLY;
  return null;
}

export type PersonDraft = {
  displayName: string;
  normalizedName: string;
  aliases: string[];
  role: PeopleRole;
  status: "needs_review";
  birthYear: number | null;
  nationality: string | null;
  region: Region | null;
  summary: string;
  sourceUrl: string;
  evidence: EvidenceClass;
  sourceRelation: SourceRelation;
  missing: string[];
};

export function draftPerson(
  input: {
    displayName: string;
    aliases: string[];
    role: string;
    birthYear: number | null;
    nationality: string | null;
    region: string | null;
    summary: string;
    sourceUrl: string;
    evidence: string;
    sourceRelation: string;
    origin: "public_source" | "pattern";
  },
  nowYear = new Date().getFullYear(),
): { ok: true; draft: PersonDraft } | { ok: false; error: string } {
  if (!input.origin || input.origin === "pattern") return { ok: false, error: NOT_A_PATTERN };
  const displayName = input.displayName.replace(/\s+/g, " ").trim();
  if (displayName.length < 2) return { ok: false, error: "Der Name fehlt." };
  if (!isPeopleRole(input.role)) return { ok: false, error: "Diese Rolle wird nicht geführt." };
  if (!isEvidence(input.evidence)) return { ok: false, error: "Unbekannte Evidenzklasse." };
  if (!isSourceRelation(input.sourceRelation)) return { ok: false, error: "Diese Quellenbeziehung wird nicht geführt." };
  const banned = judgment(`${displayName} ${input.aliases.join(" ")} ${input.summary}`) ?? rejectAsFact(input.summary, input.evidence) ?? rejectPrivate(`${displayName} ${input.aliases.join(" ")} ${input.summary} ${input.nationality ?? ""}`);
  if (banned) return { ok: false, error: banned };
  const roleBlock = classForRole(input.role, input.evidence);
  if (roleBlock) return { ok: false, error: roleBlock };
  const sourceUrl = safePublicUrl(input.sourceUrl);
  if (!sourceUrl) return { ok: false, error: NEEDS_SOURCE };
  if (input.birthYear != null && (!Number.isInteger(input.birthYear) || input.birthYear < 1800 || input.birthYear > nowYear)) {
    return { ok: false, error: "Geburtsjahr ist keine belegte Jahreszahl." };
  }
  const nationality = input.nationality?.replace(/\s+/g, " ").trim() || null;
  if (nationality && judgment(nationality)) return { ok: false, error: NO_EVALUATION };
  const rawRegion = input.region?.trim() || "";
  if (rawRegion && !isRegion(rawRegion)) return { ok: false, error: "Region ist ungültig." };
  const region: Region | null = rawRegion && isRegion(rawRegion) ? rawRegion : null;
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const alias of input.aliases) {
    const clean = alias.replace(/\s+/g, " ").trim();
    const key = normalizeName(clean);
    if (!key || key === normalizeName(displayName) || seen.has(key)) continue;
    seen.add(key);
    aliases.push(clean.slice(0, 140));
  }
  return {
    ok: true,
    draft: {
      displayName: displayName.slice(0, 140),
      normalizedName: normalizeName(displayName),
      aliases,
      role: input.role,
      status: "needs_review",
      birthYear: input.birthYear,
      nationality: nationality ? nationality.slice(0, 80) : null,
      region,
      summary: input.summary.replace(/\s+/g, " ").trim().slice(0, 2000),
      sourceUrl,
      evidence: input.evidence,
      sourceRelation: input.sourceRelation,
      missing: missingNotes({ birthYear: input.birthYear, nationality, region }),
    },
  };
}

export type KnownPerson = {
  userId: string;
  id: string;
  displayName: string;
  normalizedName: string;
  birthYear: number | null;
  nationality: string | null;
  region: string | null;
  sourceUrls: string[];
};

export function findMerge(
  actorId: string,
  incoming: { userId: string; displayName: string; birthYear: number | null; nationality: string | null; region: string | null; sourceUrl: string },
  known: KnownPerson[],
): { id: string; reason: string } | null {
  if (!actorId || incoming.userId !== actorId) return null;
  const name = normalizeName(incoming.displayName);
  if (!name) return null;
  for (const row of known) {
    if (row.userId !== actorId) continue;
    if (normalizeName(row.displayName) !== name && row.normalizedName !== name) continue;
    if (incoming.birthYear != null && row.birthYear != null && incoming.birthYear === row.birthYear) {
      return { id: row.id, reason: "gleiches Geburtsjahr" };
    }
    const nationality = normalizeName(incoming.nationality ?? "");
    const region = incoming.region ?? "";
    if (nationality && region && nationality === normalizeName(row.nationality ?? "") && region === (row.region ?? "")) {
      return { id: row.id, reason: "gleiche Herkunft und Region" };
    }
    if (incoming.sourceUrl && row.sourceUrls.includes(incoming.sourceUrl)) return { id: row.id, reason: "gleiche Quelle" };
  }
  return null;
}

export function sameNameNotice(
  actorId: string,
  incoming: { userId: string; displayName: string },
  known: KnownPerson[],
  merged: boolean,
): string {
  if (merged || !actorId || incoming.userId !== actorId) return "";
  const name = normalizeName(incoming.displayName);
  const hit = known.some((row) => row.userId === actorId && (row.normalizedName === name || normalizeName(row.displayName) === name));
  return hit ? SAME_NAME : "";
}

export function visibleTo<T extends { userId: string }>(rows: T[], actorId: string): T[] {
  if (!actorId) return [];
  return rows.filter((row) => row.userId === actorId);
}

export function ownIds(actorId: string, owners: { personOwnerId: string; caseOwnerId?: string; sourceOwnerId: string }): string | null {
  if (!actorId) return NOT_SIGNED_IN;
  if (owners.personOwnerId !== actorId || owners.sourceOwnerId !== actorId) return OTHER_ACCOUNT;
  if (owners.caseOwnerId != null && owners.caseOwnerId !== actorId) return OTHER_ACCOUNT;
  return null;
}

export function linkSource(input: {
  actorId: string;
  personOwnerId: string;
  sourceOwnerId: string;
  sourceId: string;
  relation: string;
  evidence: string;
}): { ok: true; relation: SourceRelation; evidence: EvidenceClass } | { ok: false; error: string } {
  const owner = ownIds(input.actorId, input);
  if (owner) return { ok: false, error: owner };
  if (!input.sourceId.trim()) return { ok: false, error: RELATION_NEEDS_SOURCE };
  if (!isSourceRelation(input.relation)) return { ok: false, error: "Diese Quellenbeziehung wird nicht geführt." };
  if (!isEvidence(input.evidence)) return { ok: false, error: "Unbekannte Evidenzklasse." };
  if (input.evidence === "hypothesis" || input.evidence === "speculation" || input.evidence === "unknown") return { ok: false, error: WEAK_CLASS };
  if (!PUBLIC.has(input.evidence)) return { ok: false, error: NOT_DOCUMENTED };
  return { ok: true, relation: input.relation, evidence: input.evidence };
}

export function linkCase(input: {
  actorId: string;
  personOwnerId: string;
  caseOwnerId: string;
  sourceOwnerId: string;
  sourceId: string;
  relation: string;
  evidence: string;
}): { ok: true; relation: CaseRelation; evidence: EvidenceClass } | { ok: false; error: string } {
  const owner = ownIds(input.actorId, input);
  if (owner) return { ok: false, error: owner };
  if (!input.sourceId.trim()) return { ok: false, error: RELATION_NEEDS_SOURCE };
  if (!isCaseRelation(input.relation)) return { ok: false, error: "Diese Fallbeziehung wird nicht geführt." };
  if (!isEvidence(input.evidence)) return { ok: false, error: "Unbekannte Evidenzklasse." };
  const blocked = classForRelation(input.relation, input.evidence);
  if (blocked) return { ok: false, error: blocked };
  return { ok: true, relation: input.relation, evidence: input.evidence };
}

export function reviewPerson(
  actorId: string,
  personOwnerId: string,
  sources: { evidence: EvidenceClass; ownerId: string }[],
): { ok: true; status: PeopleStatus; note: string } | { ok: false; error: string } {
  if (!actorId) return { ok: false, error: NOT_SIGNED_IN };
  if (personOwnerId !== actorId || sources.some((source) => source.ownerId !== actorId)) return { ok: false, error: OTHER_ACCOUNT };
  const enough = sources.some((source) => STRONG.has(source.evidence));
  if (!enough) return { ok: true, status: "needs_review", note: NOT_VERIFIED };
  return { ok: true, status: "verified_public", note: "Quellen geprüft. Die Belegklasse bleibt unverändert." };
}

const PRIVATE = /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)|(?:\b(?:telefon|handy|mobilnummer|privatadresse|wohnanschrift)\b)/i;

export function rejectPrivate(text: string): string | null {
  return PRIVATE.test(text) ? PRIVATE_DATA : null;
}

export function caseCountPhrase(count: number): string {
  if (!Number.isInteger(count) || count < 0) return NONE_PEOPLE;
  if (count === 0) return "Keine öffentlich dokumentierte Fallbeziehung.";
  return `${count} öffentlich dokumentierte Fallbeziehungen`;
}

export function pageWindow(page: number, size = 40): { page: number; limit: number; offset: number } {
  const limit = Math.min(40, Math.max(1, Math.trunc(size) || 40));
  const current = Number.isInteger(page) && page > 0 ? page : 1;
  return { page: current, limit, offset: (current - 1) * limit };
}

export function confidenceFor(evidence: EvidenceClass): "low" | "limited" | "notable" {
  if (evidence === "official" || evidence === "court") return "notable";
  if (evidence === "documented") return "limited";
  return "low";
}

export function timelineEvent(input: {
  label: string;
  detail: string;
  occurredOn: string;
  evidence: string;
  sourceId: string;
  caseId?: string;
}): { ok: true; event: { occurredOn: string; label: string; detail: string; evidence: EvidenceClass; sourceId: string; caseId: string; confidence: "low" | "limited" | "notable"; missingDate: boolean } } | { ok: false; error: string } {
  if (!input.sourceId.trim()) return { ok: false, error: RELATION_NEEDS_SOURCE };
  if (!isEvidence(input.evidence)) return { ok: false, error: "Unbekannte Evidenzklasse." };
  const label = input.label.replace(/\s+/g, " ").trim();
  if (label.length < 2) return { ok: false, error: "Das Ereignis braucht eine Bezeichnung." };
  const raw = input.occurredOn.trim();
  const occurredOn = raw ? dateFromText(raw) || (/^\d{4}$/.test(raw) ? raw : "") : "";
  if (raw && !occurredOn) return { ok: false, error: "Datum ist nicht belegt." };
  return {
    ok: true,
    event: {
      occurredOn,
      label: label.slice(0, 180),
      detail: input.detail.replace(/\s+/g, " ").trim().slice(0, 1000),
      evidence: input.evidence,
      sourceId: input.sourceId.trim(),
      caseId: (input.caseId ?? "").trim(),
      confidence: confidenceFor(input.evidence),
      missingDate: !occurredOn,
    },
  };
}

export function conflictingClaims(claims: { field: string; value: string; sourceId: string }[]): { field: string; left: string; right: string; leftSourceId: string; rightSourceId: string }[] {
  const groups = new Map<string, { field: string; value: string; sourceId: string }[]>();
  for (const claim of claims) {
    const list = groups.get(claim.field) ?? [];
    list.push(claim);
    groups.set(claim.field, list);
  }
  const conflicts = [];
  for (const [field, list] of groups) {
    const distinct: { field: string; value: string; sourceId: string }[] = [];
    for (const claim of list) {
      if (!distinct.some((item) => item.value === claim.value)) distinct.push(claim);
    }
    if (distinct.length < 2) continue;
    conflicts.push({
      field,
      left: distinct[0].value,
      right: distinct[1].value,
      leftSourceId: distinct[0].sourceId,
      rightSourceId: distinct[1].sourceId,
    });
  }
  return conflicts;
}

export function agreedValue(claims: { value: string }[]): string | null {
  const values = [...new Set(claims.map((claim) => claim.value).filter(Boolean))];
  return values.length === 1 ? values[0] : null;
}

function nameBase(value: string): string {
  return normalizeName(value).replace(/\b(jr|junior|sr|senior)\b/g, "").replace(/\s+/g, " ").trim();
}

export function duplicateScan(
  actorId: string,
  incoming: { userId: string; displayName: string; birthYear: number | null; nationality: string | null; region: string | null; sourceUrl: string },
  known: KnownPerson[],
): { kind: "merge"; id: string; reason: string } | { kind: "possible"; id: string; reason: string } | { kind: "none" } {
  const merge = findMerge(actorId, incoming, known);
  if (merge) return { kind: "merge", ...merge };
  if (!actorId || incoming.userId !== actorId) return { kind: "none" };
  const name = normalizeName(incoming.displayName);
  const base = nameBase(incoming.displayName);
  for (const row of known) {
    if (row.userId !== actorId) continue;
    const other = row.normalizedName || normalizeName(row.displayName);
    if (!other) continue;
    if (other === name) return { kind: "possible", id: row.id, reason: SAME_NAME };
    if (nameBase(row.displayName) === base && base.length > 0) return { kind: "possible", id: row.id, reason: POSSIBLE_DUPLICATE };
    if (jaccard(incoming.displayName, row.displayName) >= 0.6) return { kind: "possible", id: row.id, reason: POSSIBLE_DUPLICATE };
  }
  return { kind: "none" };
}

export function personResearchRequest(text: string): string | null {
  const match = text.trim().match(/^(?:recherchiere|untersuche)\s+person\s+(.{2,140})$/i);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, " ").trim();
  return name.length >= 2 ? name : null;
}

export function linkedChain(input: { personId: string; caseId: string; sourceId: string }): boolean {
  return Boolean(input.personId.trim() && input.caseId.trim() && input.sourceId.trim());
}

export function accessDecision(actorId: string, ownerId: string | null): "allow" | "not_found" {
  if (!actorId || !ownerId || actorId !== ownerId) return "not_found";
  return "allow";
}

export function decideVerification(input: {
  actorId: string;
  personOwnerId: string;
  sources: { evidence: EvidenceClass; ownerId: string }[];
  conflicts: number;
  outdated: boolean;
}): { ok: true; status: PeopleStatus; note: string } | { ok: false; error: string } {
  if (input.outdated) {
    if (!input.actorId || input.personOwnerId !== input.actorId) return { ok: false, error: OTHER_ACCOUNT };
    return { ok: true, status: "outdated", note: "Als veraltet markiert. Die Quellen bleiben unverändert." };
  }
  const reviewed = reviewPerson(input.actorId, input.personOwnerId, input.sources);
  if (!reviewed.ok) return reviewed;
  if (input.conflicts > 0) return { ok: true, status: "conflicting", note: CONFLICT_NOTE };
  const strong = input.sources.some((source) => STRONG.has(source.evidence));
  const media = input.sources.some((source) => source.evidence === "reported");
  if (strong && media) return { ok: true, status: "partially_verified", note: "Ein Teil ist behördlich oder dokumentiert. Medienberichte bleiben Medienberichte." };
  if (reviewed.status === "verified_public") return { ...reviewed, note: `${reviewed.note} ${VERIFIED_MEANS}` };
  return reviewed;
}

