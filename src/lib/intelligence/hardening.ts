/**
 * Structured matching, provenance and case links.
 * No model, no web request, no invented counts.
 */

export const MATCH_LEVELS = ["EXACT", "NORMALIZED", "SEMANTIC", "POSSIBLE", "UNKNOWN"] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

export const LINK_KINDS = [
  "SHARED_FEATURE",
  "TEMPORAL_OVERLAP",
  "GEOGRAPHIC_OVERLAP",
  "SHARED_SOURCE",
  "SHARED_ENTITY",
  "SIMILAR_METHOD",
  "SIMILAR_OBJECT",
  "SIMILAR_VEHICLE",
  "OTHER_DOCUMENTED_CONNECTION",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const SOURCE_RELATIONS = ["ORIGINAL", "DIRECT_COPY", "DERIVED_FROM", "QUOTING", "SYNDICATED", "UNKNOWN"] as const;
export type SourceRelation = (typeof SOURCE_RELATIONS)[number];

export const CHANGE_KINDS = ["ADDED", "REMOVED", "CHANGED", "CONFIRMED", "CONTRADICTED"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const GRAPH_EDGE_NOTE = "Es existiert eine dokumentierte Beziehung. Das ist keine Schuldzuweisung.";
export const NO_GUILT_LINK = "Keine Schuldzuweisung. Eine Person wird daraus nicht benannt.";
export const NOT_AVAILABLE = "NICHT VERFÜGBAR";
export const NO_NEW_DATA = "NO NEW DATA";
export const NO_NEW_CONCLUSION = "NO NEW CONCLUSION";

const COLOR_SYNONYM: Record<string, string> = {
  schwarz: "schwarz",
  schwarzer: "schwarz",
  schwarze: "schwarz",
  schwarzes: "schwarz",
  black: "schwarz",
  weiss: "weiss",
  weiß: "weiss",
  weisser: "weiss",
  weißer: "weiss",
  weisse: "weiss",
  weiße: "weiss",
  white: "weiss",
  rot: "rot",
  roter: "rot",
  rote: "rot",
  rotes: "rot",
  red: "rot",
  blau: "blau",
  blauer: "blau",
  blaue: "blau",
  blue: "blau",
  grau: "grau",
  grauer: "grau",
  grey: "grau",
  gray: "grau",
  silber: "silber",
  silberner: "silber",
  gruen: "gruen",
  grün: "gruen",
  gruener: "gruen",
  grüner: "gruen",
  green: "gruen",
};

const MAKES = ["bmw", "audi", "volkswagen", "vw", "mercedes", "opel", "ford", "toyota", "skoda", "škoda"];
const CITIES = ["karlsruhe", "stuttgart", "mannheim", "rastatt", "berlin", "hamburg", "muenchen", "münchen", "koeln", "köln", "frankfurt"];

export function foldText(value: string): string {
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

export type VehicleSlots = { make: string; model: string; color: string; type: string };

export function parseVehicle(text: string): VehicleSlots | null {
  const folded = foldText(text);
  if (!folded) return null;
  const tokens = folded.split(" ");
  const make = MAKES.find((item) => tokens.includes(item)) ?? "";
  if (!make && !/\b(auto|pkw|fahrzeug|transporter|motorrad)\b/.test(folded)) return null;
  let color = "";
  for (const token of tokens) {
    if (COLOR_SYNONYM[token]) color = COLOR_SYNONYM[token];
  }
  if (/\bdunkel/.test(folded) && !color) color = "";
  const modelMatch = folded.match(/\b(?:bmw|audi|mercedes|vw|golf|passat)\s+([a-z]?\d{1,3}er|[a-z]\d|\d{3})\b/);
  const model = modelMatch?.[1] ?? "";
  let type = "";
  if (/\bpkw\b|\bauto\b|\bfahrzeug\b/.test(folded)) type = "pkw";
  if (/\btransporter\b/.test(folded)) type = "transporter";
  if (/\bmotorrad\b/.test(folded)) type = "motorrad";
  if (!make && !model && !color && !type) return null;
  return { make, model, color, type };
}

export function matchTexts(left: string, right: string): { level: MatchLevel; reason: string; identical: boolean; mayStoreAsFact: false } {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return { level: "UNKNOWN", reason: "Leerer Text.", identical: false, mayStoreAsFact: false };
  if (a === b) return { level: "EXACT", reason: "Dieselbe Zeichenkette.", identical: true, mayStoreAsFact: false };
  if (foldText(a) === foldText(b)) {
    return { level: "NORMALIZED", reason: "Gleiche Zeichenfolge nach Schreibnorm. Keine automatische neue Tatsache.", identical: false, mayStoreAsFact: false };
  }
  const va = parseVehicle(a);
  const vb = parseVehicle(b);
  if (va && vb) {
    const slots = ["make", "model", "color", "type"] as const;
    const filled = slots.filter((slot) => va[slot] || vb[slot]);
    const both = filled.filter((slot) => va[slot] && vb[slot]);
    const conflict = both.filter((slot) => va[slot] !== vb[slot]);
    const extra = filled.filter((slot) => (va[slot] && !vb[slot]) || (!va[slot] && vb[slot]));
    if (conflict.length) {
      return { level: "POSSIBLE", reason: `Gleicher Bereich, aber ${conflict.join(", ")} widerspricht sich. Nicht gleichgesetzt.`, identical: false, mayStoreAsFact: false };
    }
    if (both.length && extra.length) {
      return { level: "POSSIBLE", reason: "Gemeinsame Angabe, aber eine Seite hat ein zusätzliches Merkmal. Nicht gleichgesetzt.", identical: false, mayStoreAsFact: false };
    }
    if (both.length && !extra.length) {
      const synonym = foldText(a) !== foldText(b);
      return {
        level: synonym ? "SEMANTIC" : "NORMALIZED",
        reason: "Dieselben Fahrzeugfelder über eine feste Slot-Regel. Kein Modell und keine gespeicherte Tatsache.",
        identical: false,
        mayStoreAsFact: false,
      };
    }
    if (va.make && va.make === vb.make) {
      return { level: "POSSIBLE", reason: "Nur die Marke stimmt überein.", identical: false, mayStoreAsFact: false };
    }
  }
  const fa = foldText(a).split(" ");
  const fb = new Set(foldText(b).split(" "));
  const shared = fa.filter((token) => token.length > 3 && fb.has(token));
  if (shared.length >= 2) {
    return { level: "POSSIBLE", reason: "Einige Wörter stimmen. Das reicht nicht für Gleichheit.", identical: false, mayStoreAsFact: false };
  }
  return { level: "UNKNOWN", reason: "Kein belegter Abgleich.", identical: false, mayStoreAsFact: false };
}

export type FeatureDraft = {
  feature: string;
  normalizedValue: string;
  originalText: string;
  confidence: "low" | "medium";
  status: "extracted";
  storable: boolean;
  reason: string;
};

export function extractFeatures(text: string, sourceId = ""): FeatureDraft[] {
  const raw = text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!raw) return [];
  const folded = foldText(raw);
  const rows: { feature: string; normalizedValue: string; confidence: "low" | "medium" }[] = [];
  const vehicle = parseVehicle(raw);
  if (vehicle?.make) rows.push({ feature: "vehicle.make", normalizedValue: vehicle.make, confidence: "medium" });
  if (vehicle?.model) rows.push({ feature: "vehicle.model", normalizedValue: vehicle.model, confidence: "medium" });
  if (vehicle?.color) rows.push({ feature: "vehicle.color", normalizedValue: vehicle.color, confidence: "medium" });
  if (vehicle?.type) rows.push({ feature: "vehicle.type", normalizedValue: vehicle.type, confidence: "low" });
  if (vehicle && !vehicle.model && /\b(auto|bmw|fahrzeug|pkw)\b/.test(folded)) {
    rows.push({ feature: "vehicle.model", normalizedValue: "VEHICLE MODEL UNKNOWN", confidence: "low" });
  }
  for (const city of CITIES) {
    if (folded.includes(foldText(city))) rows.push({ feature: "location.city", normalizedValue: foldText(city), confidence: "medium" });
  }
  if (/\bdeutschland\b|\bgermany\b/.test(folded)) rows.push({ feature: "location.country", normalizedValue: "de", confidence: "medium" });
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const de = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (iso) rows.push({ feature: "time.date", normalizedValue: iso[1], confidence: "medium" });
  else if (de) rows.push({ feature: "time.date", normalizedValue: `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`, confidence: "medium" });
  const clock = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) rows.push({ feature: "time.time", normalizedValue: `${clock[1].padStart(2, "0")}:${clock[2]}`, confidence: "medium" });
  const person = raw.match(/\bPerson:\s*([^,.]{2,80})/);
  if (person) rows.push({ feature: "person.name", normalizedValue: person[1].trim(), confidence: "low" });
  if (/\balias\s+([^,.]{2,80})/i.test(raw)) {
    const alias = raw.match(/\balias\s+([^,.]{2,80})/i);
    if (alias) rows.push({ feature: "person.alias", normalizedValue: alias[1].trim(), confidence: "low" });
  }
  if (/\bzeuge\b/i.test(raw)) rows.push({ feature: "person.role", normalizedValue: "witness_public", confidence: "low" });
  if (/\b(messer|pistole|waffe)\b/i.test(raw)) {
    const object = raw.match(/\b(messer|pistole|waffe)\b/i);
    if (object) rows.push({ feature: "object.weapon", normalizedValue: object[1].toLowerCase(), confidence: "low" });
  }
  const storable = Boolean(sourceId.trim());
  const reason = storable ? "Mit Quellen-ID extrahiert. Noch nicht geprüft." : "SOURCE MISSING. Nicht gespeichert.";
  return rows.map((row) => ({
    ...row,
    originalText: raw,
    status: "extracted" as const,
    storable,
    reason,
  }));
}

export type SearchHit = { id: string; level: MatchLevel; step: string; mayStoreAsFact: false };

export function searchPipeline(
  query: string,
  rows: { id: string; text: string; feature?: string; normalizedValue?: string; when?: string; where?: string }[],
): { step: string; hits: SearchHit[] }[] {
  const steps: { step: string; hits: SearchHit[] }[] = [];
  const exact = rows.filter((row) => row.text.trim() === query.trim()).map((row) => ({ id: row.id, level: "EXACT" as const, step: "exact", mayStoreAsFact: false as const }));
  steps.push({ step: "exact", hits: exact });
  const normalized = rows
    .filter((row) => !exact.some((hit) => hit.id === row.id) && foldText(row.text) === foldText(query) && foldText(query))
    .map((row) => ({ id: row.id, level: "NORMALIZED" as const, step: "normalization", mayStoreAsFact: false as const }));
  steps.push({ step: "normalization", hits: normalized });
  const taken = new Set([...exact, ...normalized].map((hit) => hit.id));
  const entity = rows
    .filter((row) => !taken.has(row.id))
    .map((row) => ({ row, match: matchTexts(query, row.text) }))
    .filter((item) => item.match.level === "SEMANTIC" || item.match.level === "POSSIBLE")
    .map((item) => ({ id: item.row.id, level: item.match.level, step: "entity", mayStoreAsFact: false as const }));
  steps.push({ step: "entity", hits: entity });
  for (const hit of entity) taken.add(hit.id);
  const structured = rows
    .filter((row) => row.normalizedValue && !taken.has(row.id) && foldText(query).includes(foldText(row.normalizedValue)))
    .map((row) => ({ id: row.id, level: "NORMALIZED" as const, step: "structured", mayStoreAsFact: false as const }));
  steps.push({ step: "structured feature", hits: structured });
  steps.push({
    step: "semantic",
    hits: entity.filter((hit) => hit.level === "SEMANTIC").map((hit) => ({ ...hit, step: "semantic" })),
  });
  const askedYear = query.match(/\b(20\d{2})\b/)?.[1] ?? "";
  const temporal = rows
    .filter((row) => askedYear && row.when?.startsWith(askedYear))
    .map((row) => ({ id: row.id, level: "POSSIBLE" as const, step: "temporal", mayStoreAsFact: false as const }));
  steps.push({ step: "temporal", hits: temporal });
  const askedPlace = CITIES.find((city) => foldText(query).includes(foldText(city))) ?? "";
  const geographic = rows
    .filter((row) => askedPlace && foldText(row.where ?? "").includes(foldText(askedPlace)))
    .map((row) => ({ id: row.id, level: "POSSIBLE" as const, step: "geographic", mayStoreAsFact: false as const }));
  steps.push({ step: "geographic", hits: geographic });
  return steps;
}

export type ProvenanceRow = {
  id: string;
  url: string;
  title: string;
  note?: string;
  kind?: string;
};

export type Provenance = {
  id: string;
  canonicalSourceId: string;
  sourceParentId: string;
  sourceOrigin: string;
  sourceRelationship: SourceRelation;
  duplicateGroup: string;
  independenceStatus: "independent" | "derived" | "copied" | "unknown";
};

function pmId(value: string): string {
  return value.match(/\/pm\/(\d+\/\d+)/)?.[1] ?? "";
}

export function assignProvenance(rows: ProvenanceRow[]): Provenance[] {
  const byPm = new Map<string, string>();
  for (const row of rows) {
    const id = pmId(`${row.url} ${row.note ?? ""}`);
    if (id && !byPm.has(id) && (row.kind === "official" || row.kind === "court" || /polizei/i.test(`${row.title} ${row.url}`))) {
      byPm.set(id, row.id);
    }
  }
  for (const row of rows) {
    const id = pmId(row.url);
    if (id && !byPm.has(id)) byPm.set(id, row.id);
  }
  return rows.map((row) => {
    const blob = `${row.url} ${row.title} ${row.note ?? ""}`;
    const pm = pmId(blob);
    const originId = pm ? byPm.get(pm) ?? "" : "";
    const copyLanguage = /übernimmt|uebernimmt|kopiert|wortlaut/i.test(blob);
    const quoteLanguage = /laut polizei|zufolge|zitiert/i.test(blob);
    const syndicated = /\bdpa\b|nachrichtlich/i.test(blob);
    let relationship: SourceRelation = "UNKNOWN";
    let parent = "";
    let independence: Provenance["independenceStatus"] = "unknown";
    if (originId && originId === row.id && (row.kind === "official" || row.kind === "court" || pmId(row.url))) {
      relationship = "ORIGINAL";
      independence = "independent";
    } else if (originId && originId !== row.id && quoteLanguage) {
      relationship = "QUOTING";
      parent = originId;
      independence = "derived";
    } else if (originId && originId !== row.id && copyLanguage) {
      relationship = "DIRECT_COPY";
      parent = originId;
      independence = "copied";
    } else if (originId && originId !== row.id) {
      relationship = "DERIVED_FROM";
      parent = originId;
      independence = "derived";
    } else if (syndicated) {
      relationship = "SYNDICATED";
      independence = "derived";
    } else if (copyLanguage) {
      relationship = "DIRECT_COPY";
      independence = "copied";
    } else if (row.kind === "official" || row.kind === "court") {
      relationship = "ORIGINAL";
      independence = "independent";
    }
    const canonical = relationship === "ORIGINAL" ? row.id : parent || originId || "";
    return {
      id: row.id,
      canonicalSourceId: canonical,
      sourceParentId: parent,
      sourceOrigin: pm ? `pm:${pm}` : canonical || "ORIGINAL SOURCE UNKNOWN",
      sourceRelationship: relationship,
      duplicateGroup: pm ? `pm:${pm}` : canonical || row.id,
      independenceStatus: independence,
    };
  });
}

export function independentOrigins(rows: Provenance[]): number {
  const origins = new Set<string>();
  for (const row of rows) {
    if (row.independenceStatus !== "independent" || row.sourceRelationship !== "ORIGINAL") continue;
    origins.add(row.canonicalSourceId || row.id);
  }
  return origins.size;
}

export function datasetPhrase(matching: number, dataset: { size: number; name: string } | null): string {
  if (!dataset || !Number.isInteger(dataset.size) || dataset.size < 1 || !Number.isInteger(matching) || matching < 0 || matching > dataset.size) {
    return NOT_AVAILABLE;
  }
  return `${matching} von ${dataset.size} aktuell ausgewerteten Fällen`;
}

export function missingLabels(input: {
  date: boolean;
  location: boolean;
  sourceCount: number;
  vehicleMentioned: boolean;
  vehicleModel: boolean;
  originalKnown: boolean;
}): string[] {
  const labels: string[] = [];
  if (!input.date) labels.push("DATE MISSING");
  if (!input.location) labels.push("LOCATION MISSING");
  if (input.sourceCount < 2) labels.push("SECOND SOURCE MISSING");
  if (input.vehicleMentioned && !input.vehicleModel) labels.push("VEHICLE MODEL UNKNOWN");
  if (!input.originalKnown) labels.push("ORIGINAL SOURCE UNKNOWN");
  return labels;
}

export function reanalysis(input: { beforeFingerprint: string; afterFingerprint: string; conclusion: string }): {
  data: "NO NEW DATA" | "NEW DATA";
  conclusion: string;
} {
  if (input.beforeFingerprint && input.beforeFingerprint === input.afterFingerprint) {
    return { data: "NO NEW DATA", conclusion: NO_NEW_CONCLUSION };
  }
  return { data: "NEW DATA", conclusion: input.conclusion };
}

export type EvidenceChain = {
  finding: string;
  inputFacts: { caseId: string; sourceId: string }[];
  derivationMethod: string;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  alternativeExplanation: string;
  independentSources: number;
};

export function buildEvidenceChain(input: {
  feature: string;
  matching: number;
  datasetSize: number | null;
  rows: { caseId: string; sourceId: string; origin: string }[];
}): EvidenceChain | { error: string } {
  const phrase = datasetPhrase(input.matching, input.datasetSize ? { size: input.datasetSize, name: "analysiert" } : null);
  if (phrase === NOT_AVAILABLE) return { error: NOT_AVAILABLE };
  const origins = new Set(input.rows.map((row) => row.origin).filter(Boolean));
  return {
    finding: `Merkmal ${input.feature} erscheint in ${phrase}.`,
    inputFacts: input.rows.map((row) => ({ caseId: row.caseId, sourceId: row.sourceId || "SOURCE MISSING" })),
    derivationMethod: "Zählung gespeicherter Merkmale im benannten Datenbestand. Keine Hochrechnung.",
    confidence: origins.size >= 2 ? "MEDIUM" : "LOW",
    alternativeExplanation: "Das Merkmal kann in diesem Bestand häufig sein, ohne dass die Fälle zusammenhängen.",
    independentSources: origins.size,
  };
}

const GUILT = /wahrscheinliche[rsnm]?\s+t[aä]ter|gleicher\s+t[aä]ter|denselben\s+t[aä]ter|war\s+verantwortlich|ist\s+der\s+t[aä]ter|ist\s+die\s+t[aä]terin/i;

export function forbiddenLinkClaim(text: string): boolean {
  return GUILT.test(text);
}

export function edgeStatement(): string {
  return GRAPH_EDGE_NOTE;
}

export type StoredFeature = {
  caseId: string;
  feature: string;
  normalizedValue: string;
  sourceId: string;
  when?: string;
  where?: string;
};

export function linksFromFeatures(rows: StoredFeature[]): {
  leftCaseId: string;
  rightCaseId: string;
  linkKind: LinkKind;
  linkStrength: "documented" | "possible";
  supporting: string[];
  contradicting: string[];
  sourceCount: number;
  independentSourceCount: number;
  note: string;
  storable: boolean;
}[] {
  const groups = new Map<string, StoredFeature[]>();
  for (const row of rows) {
    if (!row.caseId || !row.feature || !row.normalizedValue || row.normalizedValue.includes("UNKNOWN") || row.normalizedValue.includes("MISSING")) continue;
    const key = `${row.feature}\n${row.normalizedValue}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const drafts: ReturnType<typeof linksFromFeatures> = [];
  const seen = new Set<string>();
  for (const [key, group] of groups) {
    const cases = [...new Set(group.map((row) => row.caseId))];
    if (cases.length < 2) continue;
    for (let i = 0; i < cases.length; i += 1) {
      for (let j = i + 1; j < cases.length; j += 1) {
        const pair = [cases[i], cases[j]].sort().join("|");
        const id = `${pair}|${key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const leftRows = rows.filter((row) => row.caseId === cases[i]);
        const rightRows = rows.filter((row) => row.caseId === cases[j]);
        const contradicting: string[] = [];
        for (const left of leftRows) {
          for (const right of rightRows) {
            if (left.feature === right.feature && left.normalizedValue && right.normalizedValue && left.normalizedValue !== right.normalizedValue && !left.normalizedValue.includes("UNKNOWN") && !right.normalizedValue.includes("UNKNOWN")) {
              const label = left.feature;
              if (!contradicting.includes(label)) contradicting.push(label);
            }
          }
        }
        const sources = new Set(group.filter((row) => row.caseId === cases[i] || row.caseId === cases[j]).map((row) => row.sourceId).filter(Boolean));
        const kind: LinkKind = key.startsWith("vehicle.") ? "SIMILAR_VEHICLE" : key.startsWith("location.") ? "GEOGRAPHIC_OVERLAP" : key.startsWith("time.") ? "TEMPORAL_OVERLAP" : "SHARED_FEATURE";
        const storable = sources.size > 0 && contradicting.length === 0;
        drafts.push({
          leftCaseId: cases[i],
          rightCaseId: cases[j],
          linkKind: kind,
          linkStrength: storable ? "documented" : "possible",
          supporting: [key.replace("\n", "=")],
          contradicting,
          sourceCount: sources.size,
          independentSourceCount: 0,
          note: contradicting.length
            ? `Widerspruch bei ${contradicting.join(", ")}. Unabhängigkeit der Quellen ist hier nicht belegt. ${NO_GUILT_LINK}`
            : `Gemeinsames gespeichertes Merkmal. Unabhängigkeit der Quellen ist hier nicht belegt. ${NO_GUILT_LINK}`,
          storable,
        });
      }
    }
  }
  return drafts;
}

export function blindAnalysis(): { name: string; comparesOfficialHypothesis: boolean }[] {
  return [
    { name: "Öffentliche Angaben sammeln", comparesOfficialHypothesis: false },
    { name: "Angaben extrahieren", comparesOfficialHypothesis: false },
    { name: "Unabhängig strukturieren", comparesOfficialHypothesis: false },
    { name: "Fälle im Bestand vergleichen", comparesOfficialHypothesis: false },
    { name: "Erst danach öffentliche amtliche Hypothesen gegenüberstellen", comparesOfficialHypothesis: true },
  ];
}

export function versionChange(previous: string, next: string): ChangeKind {
  const before = previous.trim();
  const after = next.trim();
  if (!before && after) return "ADDED";
  if (before && !after) return "REMOVED";
  if (before === after) return "CONFIRMED";
  const negation = /^(nicht|kein|keine)\b/i.test(after) || /^(nicht|kein|keine)\b/i.test(before);
  if (negation && foldText(before).replace(/^nicht |^kein |^keine /, "") === foldText(after).replace(/^nicht |^kein |^keine /, "")) {
    return "CONTRADICTED";
  }
  return "CHANGED";
}

export function countPresence(
  question: string,
  rows: { caseId: string; value: string }[],
): { analyzed: number; present: number; semanticOnly: number; possibleOnly: number } {
  const analyzed = new Set(rows.map((row) => row.caseId).filter(Boolean));
  const present = new Set<string>();
  const semanticOnly = new Set<string>();
  const possibleOnly = new Set<string>();
  for (const row of rows) {
    if (!row.caseId || !row.value) continue;
    const match = matchTexts(question, row.value);
    if (match.level === "EXACT" || match.level === "NORMALIZED" || foldText(question).includes(foldText(row.value))) present.add(row.caseId);
    else if (match.level === "SEMANTIC") semanticOnly.add(row.caseId);
    else if (match.level === "POSSIBLE") possibleOnly.add(row.caseId);
  }
  for (const id of present) {
    semanticOnly.delete(id);
    possibleOnly.delete(id);
  }
  return { analyzed: analyzed.size, present: present.size, semanticOnly: semanticOnly.size, possibleOnly: possibleOnly.size };
}
