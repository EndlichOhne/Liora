import type { DataClass } from "./derive.ts";
import { deriveDataset, explainInsight, normalizeToken, parseStamp, relationEdges } from "./derive.ts";

/**
 * Cross-case discovery on stored public features only.
 * A shared feature is not a proven link and never a suspect.
 */

export const ORIGINS = [
  "official_public",
  "court_publication",
  "police_publication",
  "public_record",
  "media_report",
  "academic",
  "public_archive",
  "user_provided",
  "ai_derived",
  "unknown_origin",
] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABEL: Record<Origin, string> = {
  official_public: "Offizielle öffentliche Quelle",
  court_publication: "Gerichtsveröffentlichung",
  police_publication: "Polizeiliche Veröffentlichung",
  public_record: "Öffentliche Unterlage",
  media_report: "Medienbericht",
  academic: "Wissenschaftliche Quelle",
  public_archive: "Öffentliches Archiv",
  user_provided: "Von dir eingetragen",
  ai_derived: "Aus dem Vergleich abgeleitet",
  unknown_origin: "Herkunft unbekannt",
};

export const FEATURE_KEYS = ["merkmal", "ablauf", "gegenstand", "formulierung", "folge", "ort", "umgebung", "uhrzeit", "zeit", "fehlt"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_KEY_LABEL: Record<FeatureKey, string> = {
  merkmal: "Merkmal",
  ablauf: "Ablauf",
  gegenstand: "Gegenstand",
  formulierung: "Formulierung",
  folge: "Folge",
  ort: "Ort",
  umgebung: "Umgebung",
  uhrzeit: "Tageszeit",
  zeit: "Zeitpunkt",
  fehlt: "Fehlt ausdrücklich",
};

export const PRIORITY_LABEL = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical_review: "Prüfung nötig",
} as const;

export const CONFIDENCE_LABEL = {
  insufficient: "Nicht ausreichend",
  low: "Schwach",
  limited: "Begrenzt",
  notable: "Auffällig, nicht belegt",
} as const;

export const KIND_LABEL = {
  pattern: "Muster",
  crossover: "Quellenübergreifend",
  gap: "Öffentliche Lücke",
  cluster: "Cluster",
  negative: "Gegenbeispiel",
} as const;

export const GAP_SENTENCE =
  "Diese Information wurde in den geprüften öffentlich zugänglichen Quellen gefunden, aber in den ausgewerteten offiziellen Veröffentlichungen nicht erwähnt. Das sagt nichts darüber, was eine Behörde intern weiß.";

export const NO_PERP = "Fallvergleich ist keine Täterfeststellung. Eine Person wird daraus nicht benannt.";

const GENERIC = new Set(["region", "case_type", "case_status", "weekday", "zeit"]);
const WEAK_KEYS = new Set(["ort", "umgebung", "region"]);
const BANNED =
  /polizei\s+(weiß|weiss)\s+(das|es)\s+nicht|die\s+polizei\s+weiß\s+das\s+nicht|informationen,?\s+die\s+die\s+polizei\s+nicht\s+hat|definitiv\s+denselben\s+täter|denselben\s+täter|wir\s+haben\s+den\s+täter|täter\s+gefunden/i;

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export type FeatureInput = {
  caseId: string;
  caseTitle: string;
  key: string;
  value: string;
  origin: Origin;
  evidence: string;
  sourceUrl: string;
  auto?: boolean;
};

export type CaseSeed = {
  id: string;
  title: string;
  region: string;
  city: string;
  place: string;
  caseType: string;
  caseStatus: string;
  openedOn: string;
  events: { occurredOn: string; label: string; evidence: string; sourceUrl: string; sourceKind?: string }[];
  items: { body: string; evidence: string; sourceUrl: string; kind: string }[];
};

export type InsightDraft = {
  key: string;
  kind: "pattern" | "gap" | "cluster" | "negative" | "crossover";
  title: string;
  priority: keyof typeof PRIORITY_LABEL;
  confidence: keyof typeof CONFIDENCE_LABEL;
  status: "open" | "downgraded" | "held";
  reason: string;
  alternative: string;
  disconfirmation: string;
  chain: string[];
  sources: string[];
  caseIds: string[];
  featureNote: string;
  officialNote: string;
  dataClass: DataClass;
  marks: string;
  rarity: string;
  calculations: string[];
  differences: string[];
  unknown: string[];
  nextQuestions: string[];
  method: string;
};

type RawInsight = Omit<InsightDraft, "dataClass" | "marks" | "rarity" | "calculations" | "differences" | "unknown" | "nextQuestions" | "method">;

type Indexed = FeatureInput & { signature: string };

export function isOrigin(value: string): value is Origin {
  return (ORIGINS as readonly string[]).includes(value);
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isOfficialOrigin(origin: Origin): boolean {
  return origin === "official_public" || origin === "court_publication" || origin === "police_publication";
}

export function rejectDiscoveryClaim(text: string): string | null {
  if (BANNED.test(text)) return "Unzulässig. Ein Muster benennt keinen Täter und sagt nichts über internes Behördenwissen.";
  return null;
}

export function originFor(evidence: string, sourceKind = ""): Origin {
  if (evidence === "court" || sourceKind === "court") return "court_publication";
  if (sourceKind === "police" || sourceKind === "press_release") return "police_publication";
  if (sourceKind === "prosecutor" || evidence === "official") return "official_public";
  if (sourceKind === "science") return "academic";
  if (evidence === "documented") return "public_record";
  if (evidence === "reported" || sourceKind === "media") return "media_report";
  return "unknown_origin";
}

export function originMatchesEvidence(origin: Origin, evidence: string): string | null {
  if (origin === "ai_derived") return "Abgeleitete Verbindungen legt nur der Vergleich an, nicht das Formular.";
  if (origin === "court_publication" && evidence !== "court") return "Gerichtsveröffentlichung nur mit der Klasse Gericht.";
  if ((origin === "official_public" || origin === "police_publication") && !["official", "documented", "court"].includes(evidence)) {
    return "Offizielle Herkunft passt nicht zu dieser Klasse.";
  }
  if (origin === "media_report" && !["reported", "alleged"].includes(evidence)) return "Ein Medienbericht bleibt medial oder behauptet.";
  return null;
}

function norm(value: string): string {
  return normalizeToken(value);
}

function signatureOf(feature: { key: string; value: string }): string {
  return `${feature.key}:${norm(feature.value)}`;
}

function weekdayName(raw: string): string | null {
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return null;
  return WEEKDAYS[new Date(time).getUTCDay()] ?? null;
}

function dayPart(raw: string): string | null {
  const match = raw.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
  if (!match?.[1]) return null;
  const hour = Number(match[1]);
  if (hour < 6) return "Nacht";
  if (hour < 12) return "Vormittag";
  if (hour < 18) return "Nachmittag";
  return "Abend";
}

function dedupe(rows: FeatureInput[]): FeatureInput[] {
  const seen = new Set<string>();
  const kept: FeatureInput[] = [];
  for (const row of rows) {
    const id = `${row.caseId}|${signatureOf(row)}|${row.origin}|${row.sourceUrl}`;
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(row);
  }
  return kept;
}

export function extractCaseFeatures(seed: CaseSeed): FeatureInput[] {
  const out: FeatureInput[] = [];
  const push = (key: string, value: string, origin: Origin, evidence: string, sourceUrl: string) => {
    const clean = value.trim().slice(0, 160);
    if (clean.length < 2) return;
    if (evidence === "hypothesis" || evidence === "speculation") return;
    if (rejectDiscoveryClaim(clean)) return;
    out.push({
      caseId: seed.id,
      caseTitle: seed.title,
      key,
      value: clean,
      origin,
      evidence,
      sourceUrl: sourceUrl.slice(0, 500),
      auto: true,
    });
  };
  if (seed.region) push("region", seed.region, "user_provided", "unknown", "");
  if (seed.city) push("ort", seed.city, "user_provided", "unknown", "");
  if (seed.place) push("umgebung", seed.place, "user_provided", "unknown", "");
  if (seed.caseType) push("case_type", seed.caseType, "user_provided", "unknown", "");
  if (seed.caseStatus) push("case_status", seed.caseStatus, "user_provided", "unknown", "");
  const openedDay = weekdayName(seed.openedOn);
  if (openedDay) push("weekday", openedDay, "user_provided", "unknown", "");
  const openedPart = dayPart(seed.openedOn);
  if (openedPart) push("uhrzeit", openedPart, "user_provided", "unknown", "");
  const openedStamp = parseStamp(seed.openedOn);
  if (openedStamp) push("zeit", openedStamp.day, "user_provided", "unknown", "");
  for (const event of seed.events) {
    const origin = originFor(event.evidence, event.sourceKind ?? "");
    const stamp = parseStamp(event.occurredOn);
    if (stamp) push("zeit", stamp.day, origin, event.evidence, event.sourceUrl);
    const day = weekdayName(event.occurredOn);
    if (day) push("weekday", day, origin, event.evidence, event.sourceUrl);
    const part = dayPart(`${event.occurredOn} ${event.label}`);
    if (part) push("uhrzeit", part, origin, event.evidence, event.sourceUrl);
    if (event.label.trim().length >= 4 && event.label.trim().length <= 80) push("ablauf", event.label.trim(), origin, event.evidence, event.sourceUrl);
  }
  for (const item of seed.items) {
    if (item.kind !== "marker" && item.kind !== "feature") continue;
    push("merkmal", item.body, originFor(item.evidence), item.evidence, item.sourceUrl);
  }
  return dedupe(out);
}

export function featureFingerprint(features: FeatureInput[]): string {
  return features
    .map((feature) => `${feature.caseId}|${signatureOf(feature)}|${feature.origin}|${feature.sourceUrl}|${feature.auto ? "a" : "u"}`)
    .sort()
    .join("\n");
}

export function featureNetwork(features: FeatureInput[]): { from: string; relation: string; to: string }[] {
  const edges: { from: string; relation: string; to: string }[] = [];
  for (const feature of features) {
    if (GENERIC.has(feature.key) || WEAK_KEYS.has(feature.key)) continue;
    edges.push({
      from: feature.caseTitle || feature.caseId,
      relation: "hat Merkmal",
      to: `${feature.key}: ${feature.value}`,
    });
    if (feature.sourceUrl) {
      edges.push({ from: `${feature.key}: ${feature.value}`, relation: "Quelle", to: feature.sourceUrl });
    }
  }
  return edges.slice(0, 30);
}

function uniqueSources(rows: FeatureInput[]): string[] {
  return [...new Set(rows.map((row) => row.sourceUrl).filter(Boolean))];
}

function independentCount(rows: FeatureInput[]): number {
  const urls = uniqueSources(rows);
  if (urls.length) return urls.length;
  return new Set(rows.map((row) => row.origin)).size || 1;
}

export function disconfirmPair(shared: FeatureInput[], left: FeatureInput[], right: FeatureInput[]): { kill: boolean; notes: string[] } {
  const notes: string[] = [];
  if (shared.some((feature) => rejectDiscoveryClaim(feature.value))) {
    return { kill: true, notes: ["Die Formulierung würde eine Person festlegen. Verworfen."] };
  }
  const absent = [...left, ...right].filter((feature) => feature.key === "fehlt");
  for (const feature of shared) {
    if (absent.some((item) => norm(item.value) === norm(feature.value))) {
      return { kill: true, notes: [`Gespeichertes Gegenmerkmal zu „${feature.value}“. Zusammenhang zurückgestuft.`] };
    }
  }
  const cities = new Set([...left, ...right].filter((feature) => feature.key === "ort").map((feature) => norm(feature.value)));
  if (cities.size > 1) notes.push("Die Orte unterscheiden sich. Das schwächt einen engen Zusammenhang.");
  const times = new Set([...left, ...right].filter((feature) => feature.key === "uhrzeit").map((feature) => norm(feature.value)));
  if (times.size > 1) notes.push("Die Tageszeiten unterscheiden sich.");
  if (independentCount(shared) < 2) notes.push("Zu wenige unabhängige Quellen. Zufall bleibt möglich.");
  if (!notes.length) notes.push("Kein hartes Gegenargument in den gespeicherten Merkmalen. Trotzdem keine belegte Verbindung.");
  return { kill: false, notes };
}

function priorityFor(specificCount: number, sources: number, killed: boolean): InsightDraft["priority"] {
  if (killed || specificCount < 2 || sources < 2) return "low";
  if (specificCount >= 4 && sources >= 3) return "critical_review";
  if (specificCount >= 3 && sources >= 2) return "high";
  return "medium";
}

function confidenceFor(priority: InsightDraft["priority"], killed: boolean): InsightDraft["confidence"] {
  if (killed) return "insufficient";
  if (priority === "low") return "low";
  if (priority === "medium") return "limited";
  return "notable";
}

function indexFeatures(features: FeatureInput[]): Map<string, Indexed[]> {
  const map = new Map<string, Indexed[]>();
  for (const feature of features) {
    const list = map.get(feature.caseId) ?? [];
    list.push({ ...feature, signature: signatureOf(feature) });
    map.set(feature.caseId, list);
  }
  return map;
}

function officialNoteFor(shared: Indexed[], left: Indexed[], right: Indexed[]): string {
  const lines: string[] = [];
  const alsoOfficial: string[] = [];
  const onlyOther: string[] = [];
  const seen = new Set<string>();
  for (const feature of shared) {
    if (seen.has(feature.signature)) continue;
    seen.add(feature.signature);
    const rows = [...left, ...right].filter((item) => item.signature === feature.signature);
    if (rows.some((item) => isOfficialOrigin(item.origin))) alsoOfficial.push(feature.value);
    else onlyOther.push(feature.value);
  }
  if (alsoOfficial.length) lines.push(`Aus geprüften offiziellen Quellen: ${alsoOfficial.join(", ")}.`);
  if (onlyOther.length) lines.push(`Nur außerhalb der geprüften offiziellen Merkmale: ${onlyOther.join(", ")}. ${GAP_SENTENCE}`);
  lines.push("Der Zusammenhang selbst ist aus dem Vergleich abgeleitet und wird von keiner gespeicherten Quelle behauptet.");
  lines.push(NO_PERP);
  return lines.join(" ");
}

export function discover(features: FeatureInput[]): { insights: InsightDraft[]; derived: ReturnType<typeof deriveDataset>; graph: ReturnType<typeof relationEdges>; note: string } {
  const byCase = indexFeatures(features);
  const caseIds = [...byCase.keys()];
  if (caseIds.length < 2) {
    return { insights: [], derived: deriveDataset(features), graph: relationEdges(features), note: "Mindestens zwei Akten mit Merkmalen. Es wird nichts erfunden." };
  }
  const insights: RawInsight[] = [];

  for (let i = 0; i < caseIds.length; i += 1) {
    for (let j = i + 1; j < caseIds.length; j += 1) {
      const left = byCase.get(caseIds[i]) ?? [];
      const right = byCase.get(caseIds[j]) ?? [];
      const rightSigs = new Set(right.map((feature) => feature.signature));
      const seen = new Set<string>();
      const shared = left.filter((feature) => {
        if (GENERIC.has(feature.key) || !rightSigs.has(feature.signature) || seen.has(feature.signature)) return false;
        seen.add(feature.signature);
        return true;
      });
      if (!shared.length) continue;
      if (shared.every((feature) => WEAK_KEYS.has(feature.key) && !feature.sourceUrl)) continue;
      const both = shared.flatMap((feature) => [...left, ...right].filter((item) => item.signature === feature.signature));
      const check = disconfirmPair(shared, left, right);
      const blindCount = shared.filter((feature) => [...left, ...right].filter((item) => item.signature === feature.signature).some((item) => !isOfficialOrigin(item.origin))).length;
      const sourceCount = independentCount(both);
      const officialOnly = blindCount === 0;
      const priority = officialOnly ? "low" : priorityFor(blindCount, sourceCount, check.kill);
      const confidence = confidenceFor(priority, check.kill);
      const status = check.kill ? "downgraded" : priority === "low" ? "held" : "open";
      const titles = [left[0]?.caseTitle || caseIds[i], right[0]?.caseTitle || caseIds[j]];
      const featureNote = shared.map((feature) => `${feature.key}: ${feature.value}`).join("; ");
      const origins = new Set(both.map((feature) => feature.origin));
      const crossover = !officialOnly && origins.size >= 2 && shared.length >= 2;
      const reason = shared.length < 2
        ? `Nur ein gemeinsames Detail (${featureNote}). Ein einzelnes Detail ist kein Muster und kein Tätermerkmal.`
        : officialOnly
          ? `Nur Merkmale aus geprüften offiziellen Quellen: ${featureNote}. Das wiederholt die Veröffentlichungen, es ist kein neues Muster.`
          : `Zuerst ohne offizielle Theorie geprüft. Gemeinsame Merkmale: ${featureNote}. Keine gespeicherte Quelle sagt, dass die Akten zusammenhängen.`;
      insights.push({
        key: `pair:${[caseIds[i], caseIds[j]].sort().join(":")}:${shared.map((feature) => feature.signature).sort().join("|")}`,
        kind: crossover ? "crossover" : "pattern",
        title: shared.length >= 2 ? `Muster ${titles[0]} und ${titles[1]}` : `Ein Detail in ${titles[0]} und ${titles[1]}`,
        priority,
        confidence,
        status,
        reason,
        alternative: check.kill
          ? "Der Zusammenhang hält der Gegenprüfung nicht stand."
          : "Zufall, ähnliche Berichterstattung oder gleiche Aktenfelder bleiben möglich. Kein belegter Zusammenhang.",
        disconfirmation: `${check.notes.join(" ")} Was die Bewertung ändern würde: ein gespeichertes Gegenmerkmal oder eine Quelle, die ein Merkmal bestreitet.`,
        chain: [
          `Herkunft der Verbindung: ${ORIGIN_LABEL.ai_derived}`,
          `Akte: ${titles[0]}`,
          ...shared.map((feature) => `Merkmal ${feature.key} = ${feature.value}`),
          `Quellen: ${uniqueSources(both).join(", ") || "keine URL gespeichert"}`,
          `Akte: ${titles[1]}`,
          "Vergleich nur über gleiche gespeicherte Merkmale",
          check.kill ? "Gegenprüfung verwirft den Zusammenhang" : "Gegenprüfung findet kein hartes Gegenargument",
          "Schluss: mögliches Muster, nicht belegt",
        ],
        sources: uniqueSources(both),
        caseIds: [caseIds[i] as string, caseIds[j] as string],
        featureNote,
        officialNote: officialNoteFor(shared, left, right),
      });
    }
  }

  const negatives: RawInsight[] = [];
  for (const insight of insights) {
    if (insight.status === "downgraded" || insight.caseIds.length !== 2) continue;
    const [a, b] = insight.caseIds;
    if (!a || !b) continue;
    const typeA = (byCase.get(a) ?? []).find((feature) => feature.key === "case_type");
    const typeB = (byCase.get(b) ?? []).find((feature) => feature.key === "case_type");
    if (!typeA || !typeB || typeA.signature !== typeB.signature) continue;
    const sharedSigs = (byCase.get(a) ?? []).filter((feature) => !GENERIC.has(feature.key) && (byCase.get(b) ?? []).some((item) => item.signature === feature.signature));
    for (const otherId of caseIds) {
      if (otherId === a || otherId === b) continue;
      const other = byCase.get(otherId) ?? [];
      if (!other.some((feature) => feature.signature === typeA.signature)) continue;
      const otherSigs = new Set(other.map((feature) => feature.signature));
      const missing = sharedSigs.filter((feature) => !otherSigs.has(feature.signature));
      if (!missing.length) continue;
      const title = other[0]?.caseTitle || otherId;
      negatives.push({
        key: `neg:${insight.key}:${otherId}`,
        kind: "negative",
        title: `Gegenbeispiel ${title}`,
        priority: "low",
        confidence: "limited",
        status: "open",
        reason: `${title} hat denselben Typ, aber es fehlt: ${missing.map((feature) => feature.value).join(", ")}. Das wird nicht ignoriert.`,
        alternative: "Der Typ allein ist häufig. Das fehlende Merkmal spricht gegen ein durchgehendes Muster.",
        disconfirmation: "Negativbefund aus gespeicherten Merkmalen, nicht aus einer Vermutung.",
        chain: [`Vergleichsmerkmal fehlt in ${title}`, ...missing.map((feature) => `Fehlt: ${feature.key} = ${feature.value}`), NO_PERP],
        sources: [],
        caseIds: [a, b, otherId],
        featureNote: missing.map((feature) => feature.value).join("; "),
        officialNote: NO_PERP,
      });
      break;
    }
  }
  insights.push(...negatives);

  const bySig = new Map<string, { feature: Indexed; cases: Set<string> }>();
  for (const rows of byCase.values()) {
    for (const feature of rows) {
      if (GENERIC.has(feature.key) || WEAK_KEYS.has(feature.key)) continue;
      if (!feature.sourceUrl) continue;
      const slot = bySig.get(feature.signature) ?? { feature, cases: new Set<string>() };
      slot.cases.add(feature.caseId);
      bySig.set(feature.signature, slot);
    }
  }
  const sigs = [...bySig.entries()].filter(([, slot]) => slot.cases.size >= 2);
  const seenClusters = new Set<string>();
  for (let i = 0; i < sigs.length && insights.filter((item) => item.kind === "cluster").length < 8; i += 1) {
    for (let j = i + 1; j < sigs.length && insights.filter((item) => item.kind === "cluster").length < 8; j += 1) {
      const left = sigs[i]?.[1];
      const right = sigs[j]?.[1];
      if (!left || !right) continue;
      const both = [...left.cases].filter((id) => right.cases.has(id));
      if (both.length < 2) continue;
      const idKey = both.slice().sort().join("|");
      if (seenClusters.has(idKey)) continue;
      seenClusters.add(idKey);
      const extra = [...bySig.entries()].filter(([signature, slot]) => signature !== sigs[i]?.[0] && signature !== sigs[j]?.[0] && both.every((id) => slot.cases.has(id)));
      const parts = [left.feature, right.feature, ...extra.map(([, slot]) => slot.feature)];
      const names = both.map((id) => (byCase.get(id) ?? [])[0]?.caseTitle || id);
      insights.push({
        key: `cluster:${idKey}:${parts.map((feature) => feature.signature).sort().join("|")}`,
        kind: "cluster",
        title: `Cluster aus ${both.length} Akten`,
        priority: parts.length >= 3 && both.length >= 3 ? "medium" : "low",
        confidence: "limited",
        status: "held",
        reason: `${names.join(", ")} teilen ${parts.map((feature) => `${feature.key}: ${feature.value}`).join("; ")}. Status: mögliches Muster, nicht belegt.`,
        alternative: "Ähnliche Berichterstattung kann dieselben Merkmale unabhängig erzeugen.",
        disconfirmation: "Ein Cluster ist nur die Schnittmenge gespeicherter Merkmale. Keine Personenverknüpfung.",
        chain: ["Mehrere Akten", ...parts.map((feature) => `Gemeinsam: ${feature.value}`), "Schnittmenge, nicht belegt", NO_PERP],
        sources: uniqueSources(parts),
        caseIds: both,
        featureNote: parts.map((feature) => `${feature.key}: ${feature.value}`).join("; "),
        officialNote: parts.every((feature) => isOfficialOrigin(feature.origin))
          ? `${NO_PERP} Die gemeinsamen Merkmale stehen in geprüften offiziellen Quellen. Der Zusammenhang wird dort nicht behauptet.`
          : `${NO_PERP} ${GAP_SENTENCE}`,
      });
    }
  }

  for (const [caseId, rows] of byCase) {
    const official = rows.filter((feature) => isOfficialOrigin(feature.origin));
    if (!official.length) continue;
    const officialText = official.map((feature) => norm(`${feature.key} ${feature.value}`)).join(" | ");
    const gaps = rows.filter((feature) => !isOfficialOrigin(feature.origin) && feature.origin !== "user_provided" && !GENERIC.has(feature.key) && !WEAK_KEYS.has(feature.key) && feature.key !== "fehlt" && !officialText.includes(norm(feature.value)));
    for (const gap of gaps.slice(0, 3)) {
      insights.push({
        key: `gap:${caseId}:${gap.signature}`,
        kind: "gap",
        title: `Öffentliche Lücke in ${gap.caseTitle || caseId}`,
        priority: "low",
        confidence: "limited",
        status: "open",
        reason: `„${gap.value}“ steht als ${ORIGIN_LABEL[gap.origin]} in den geprüften Quellen. In den offiziellen Merkmalen dieser Akte kommt es nicht vor.`,
        alternative: "Die offiziellen Veröffentlichungen sind in der Akte unvollständig, oder das Merkmal war für die Meldung unerheblich.",
        disconfirmation: "Das ist keine Aussage über internes Wissen einer Behörde.",
        chain: [`Merkmal: ${gap.value}`, `Herkunft: ${ORIGIN_LABEL[gap.origin]}`, gap.sourceUrl || "keine URL", "Nicht in den gespeicherten offiziellen Merkmalen dieser Akte", GAP_SENTENCE],
        sources: gap.sourceUrl ? [gap.sourceUrl] : [],
        caseIds: [caseId],
        featureNote: gap.value,
        officialNote: GAP_SENTENCE,
      });
    }
  }

  const rank = { critical_review: 0, high: 1, medium: 2, low: 3 };
  const guarded = insights.map((insight) => {
    const blob = `${insight.title} ${insight.reason} ${insight.officialNote} ${insight.disconfirmation} ${insight.alternative}`;
    if (!rejectDiscoveryClaim(blob)) return insight;
    return { ...insight, status: "downgraded" as const, priority: "low" as const, confidence: "insufficient" as const, reason: "Formulierung verworfen.", officialNote: NO_PERP };
  });
  guarded.sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title, "de"));
  const limited = guarded.slice(0, 24);
  const explained = limited.map((insight) => {
    const extra = explainInsight(insight, features, caseIds.length);
    const chain = [...insight.chain, ...extra.calculations.slice(0, 3).map((line) => `Berechnung: ${line}`)].slice(0, 16);
    return { ...insight, ...extra, chain };
  });
  return {
    insights: explained,
    derived: deriveDataset(features),
    graph: relationEdges(features),
    note: explained.length
      ? `${explained.length} Vergleichsergebnisse aus gespeicherten Merkmalen. Nichts davon ist eine Täterfeststellung.`
      : "Keine seltene Merkmalskombination in den gespeicherten Akten.",
  };
}
