/**
 * Calculations on stored case features.
 * Missing inputs stay insufficient. No kilometres, no probabilities, no suspects.
 */

export type DataClass = "insufficient" | "unverified" | "single_source" | "ai_derived";

export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  insufficient: "Nicht genug Daten",
  unverified: "Ungeprüfte Verbindung",
  single_source: "Nur eine Quelle",
  ai_derived: "Aus dem Vergleich abgeleitet",
};

export type DerivedPoint = {
  kind: "time_gap" | "place_relation" | "combo_count" | "holiday" | "spelling";
  value: string;
  method: string;
  inputs: string;
  caseIds: string[];
};

export type GraphEdge = {
  from: string;
  relation: string;
  to: string;
};

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDate(year: number, month: number, day: number, shift = 0): string {
  const date = new Date(Date.UTC(year, month - 1, day + shift));
  return date.toISOString().slice(0, 10);
}

export function germanHoliday(isoDate: string, region = ""): string | null {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const key = date.toISOString().slice(0, 10);
  const easter = easterSunday(year);
  const fixed: Record<string, string> = {
    [`${year}-01-01`]: "Neujahr",
    [`${year}-05-01`]: "Tag der Arbeit",
    [`${year}-10-03`]: "Tag der Deutschen Einheit",
    [`${year}-12-25`]: "Erster Weihnachtstag",
    [`${year}-12-26`]: "Zweiter Weihnachtstag",
  };
  const movable: Record<string, string> = {
    [utcDate(year, easter.getUTCMonth() + 1, easter.getUTCDate(), -2)]: "Karfreitag",
    [utcDate(year, easter.getUTCMonth() + 1, easter.getUTCDate(), 1)]: "Ostermontag",
    [utcDate(year, easter.getUTCMonth() + 1, easter.getUTCDate(), 39)]: "Christi Himmelfahrt",
    [utcDate(year, easter.getUTCMonth() + 1, easter.getUTCDate(), 50)]: "Pfingstmontag",
  };
  if (fixed[key]) return fixed[key];
  if (movable[key]) return movable[key];
  const bw = /karlsruhe|stuttgart|mannheim|rastatt|^bw$|baden/.test(region.toLowerCase());
  if (!bw) return null;
  const state: Record<string, string> = {
    [`${year}-01-06`]: "Heilige Drei Könige",
    [utcDate(year, easter.getUTCMonth() + 1, easter.getUTCDate(), 60)]: "Fronleichnam",
    [`${year}-11-01`]: "Allerheiligen",
  };
  return state[key] ?? null;
}

export function parseStamp(raw: string): { day: string; weekday: string; part: string } | null {
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const hasClock = /T\d{2}:\d{2}/.test(raw) || /\b([01]?\d|2[0-3]):[0-5]\d\b/.test(raw);
  const hour = date.getUTCHours();
  const part = !hasClock ? "" : hour < 6 ? "Nacht" : hour < 12 ? "Vormittag" : hour < 18 ? "Nachmittag" : "Abend";
  return { day: date.toISOString().slice(0, 10), weekday: WEEKDAYS[date.getUTCDay()] ?? "", part };
}

export function timeGap(left: string, right: string): { days: number | null; text: string } {
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return { days: null, text: "INSUFFICIENT DATA. Mindestens ein Zeitpunkt ist nicht lesbar. Es wurde keine Zeitdifferenz erfunden." };
  }
  const days = Math.round((Math.abs(a - b) / 86_400_000) * 10) / 10;
  const order = a === b ? "Dieselben Zeitpunkte." : a < b ? "Der erste Zeitpunkt liegt vorher." : "Der zweite Zeitpunkt liegt vorher.";
  return { days, text: `${days} Tage Abstand. Methode: Betrag der UTC-Differenz. ${order}` };
}

export function placeRelation(left: { city: string; region: string }, right: { city: string; region: string }): { kind: "same_place" | "same_region" | "different" | "insufficient"; text: string } {
  const cityA = normalizeToken(left.city);
  const cityB = normalizeToken(right.city);
  if (!cityA || !cityB) {
    return { kind: "insufficient", text: "INSUFFICIENT DATA. Nicht beide Akten haben einen Ort. Es wurde keine Entfernung erfunden." };
  }
  if (cityA === cityB) {
    return { kind: "same_place", text: "Gleicher normalisierter Ort. Keine Koordinaten gespeichert, deshalb keine Kilometer." };
  }
  if (left.region && left.region === right.region) {
    return { kind: "same_region", text: "Gleiche Region, verschiedene Orte. Entfernung nicht berechnet, weil keine Koordinaten gespeichert sind." };
  }
  return { kind: "different", text: "Verschiedene Orte. Entfernung nicht berechnet, weil keine Koordinaten gespeichert sind." };
}

export function rarityOf(count: number, total: number): { label: "insufficient" | "common" | "uncommon" | "rare_in_set"; text: string } {
  if (total < 4) {
    return { label: "insufficient", text: `INSUFFICIENT DATA. ${count} von ${total} gespeicherten Akten. Zu wenige Akten für eine Seltenheitsaussage. Keine Wahrscheinlichkeit.` };
  }
  const ratio = count / total;
  if (ratio >= 0.5) return { label: "common", text: `In diesem Bestand häufig: ${count} von ${total}. Keine Aussage über die Welt außerhalb der Akten.` };
  if (ratio >= 0.25) return { label: "uncommon", text: `In diesem Bestand ungewöhnlich, aber nicht selten: ${count} von ${total}.` };
  return { label: "rare_in_set", text: `In diesem Bestand selten: ${count} von ${total}. Das ist keine Täterschaft und keine echte Bevölkerungszahl.` };
}

export function sourceHosts(urls: string[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      continue;
    }
  }
  return [...hosts];
}

export const ANALYSIS_METHOD = "stored-feature-compare-v2";

export const DERIVED_KIND_LABEL: Record<DerivedPoint["kind"], string> = {
  time_gap: "Zeitabstand",
  place_relation: "Ort",
  combo_count: "Häufigkeit",
  holiday: "Feiertag",
  spelling: "Schreibweise",
};

export type StoredFeature = {
  caseId: string;
  caseTitle: string;
  key: string;
  value: string;
  origin: string;
  sourceUrl: string;
};

const SKIP_MATCH = new Set(["region", "case_type", "case_status", "weekday", "zeit"]);
const WEAK_PLACE = new Set(["ort", "umgebung", "region"]);

function signature(feature: { key: string; value: string }): string {
  return `${feature.key}:${normalizeToken(feature.value)}`;
}

function titleOf(features: StoredFeature[], caseId: string): string {
  return features.find((feature) => feature.caseId === caseId && feature.caseTitle)?.caseTitle || caseId;
}

function regionOf(features: StoredFeature[], caseId: string): string {
  return features.find((feature) => feature.caseId === caseId && feature.key === "region")?.value ?? "";
}

function cityOf(features: StoredFeature[], caseId: string): string {
  return features.find((feature) => feature.caseId === caseId && feature.key === "ort")?.value ?? "";
}

type StampRow = {
  caseId: string;
  caseTitle: string;
  value: string;
  time: number;
  day: string;
  weekday: string;
  part: string;
  region: string;
};

function stampsOf(features: StoredFeature[]): StampRow[] {
  const rows: StampRow[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (feature.key !== "zeit") continue;
    const parsed = parseStamp(feature.value);
    const time = Date.parse(feature.value);
    if (!parsed || Number.isNaN(time)) continue;
    const id = `${feature.caseId}|${parsed.day}|${parsed.part}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      caseId: feature.caseId,
      caseTitle: feature.caseTitle || feature.caseId,
      value: feature.value,
      time,
      day: parsed.day,
      weekday: parsed.weekday,
      part: parsed.part,
      region: regionOf(features, feature.caseId),
    });
  }
  rows.sort((a, b) => a.time - b.time || a.caseId.localeCompare(b.caseId));
  return rows;
}

function caseIdsOf(features: StoredFeature[]): string[] {
  return [...new Set(features.map((feature) => feature.caseId))].sort();
}

export function deriveDataset(features: StoredFeature[]): DerivedPoint[] {
  const points: DerivedPoint[] = [];
  const caseIds = caseIdsOf(features);
  const total = caseIds.length;
  const stamps = stampsOf(features);

  for (let i = 0; i < stamps.length - 1 && points.filter((point) => point.kind === "time_gap").length < 8; i += 1) {
    const left = stamps[i];
    const right = stamps[i + 1];
    if (!left || !right) continue;
    const gap = timeGap(left.value, right.value);
    const leftWhen = [left.weekday, left.part].filter(Boolean).join(" ");
    const rightWhen = [right.weekday, right.part].filter(Boolean).join(" ");
    points.push({
      kind: "time_gap",
      value: `${left.caseTitle} (${left.day}${leftWhen ? `, ${leftWhen}` : ""}) und ${right.caseTitle} (${right.day}${rightWhen ? `, ${rightWhen}` : ""}): ${gap.text}`,
      method: ANALYSIS_METHOD,
      inputs: `${left.value} | ${right.value}`,
      caseIds: [...new Set([left.caseId, right.caseId])],
    });
  }
  if (stamps.length >= 3) {
    points.push({
      kind: "time_gap",
      value: `Reihenfolge: ${stamps.map((stamp) => `${stamp.caseTitle} ${stamp.day}`).join(", ")}.`,
      method: ANALYSIS_METHOD,
      inputs: stamps.map((stamp) => stamp.value).join(" | "),
      caseIds: [...new Set(stamps.map((stamp) => stamp.caseId))],
    });
  }

  const seenHoliday = new Set<string>();
  for (const stamp of stamps) {
    if (seenHoliday.has(`${stamp.caseId}|${stamp.day}`)) continue;
    const name = germanHoliday(stamp.day, stamp.region);
    if (!name) continue;
    seenHoliday.add(`${stamp.caseId}|${stamp.day}`);
    points.push({
      kind: "holiday",
      value: `${stamp.caseTitle}: ${stamp.day} fällt auf ${name}. Gerechnet mit dem gregorianischen Kalender. Ein Landesfeiertag nur bei passender Region. Keine Tatbehauptung.`,
      method: ANALYSIS_METHOD,
      inputs: `${stamp.value} | ${stamp.region || "keine Region"}`,
      caseIds: [stamp.caseId],
    });
    if (points.filter((point) => point.kind === "holiday").length >= 6) break;
  }

  const located = caseIds.slice(0, 12).map((id) => ({
    id,
    title: titleOf(features, id),
    city: cityOf(features, id),
    region: regionOf(features, id),
  }));
  for (let i = 0; i < located.length && points.filter((point) => point.kind === "place_relation").length < 8; i += 1) {
    for (let j = i + 1; j < located.length && points.filter((point) => point.kind === "place_relation").length < 8; j += 1) {
      const left = located[i];
      const right = located[j];
      if (!left || !right || !left.city || !right.city) continue;
      const relation = placeRelation(left, right);
      points.push({
        kind: "place_relation",
        value: `${left.title} und ${right.title}: ${relation.text}`,
        method: ANALYSIS_METHOD,
        inputs: `${left.city}|${left.region}|${right.city}|${right.region}`,
        caseIds: [left.id, right.id],
      });
    }
  }

  const spellings = new Map<string, StoredFeature[]>();
  for (const feature of features) {
    if (SKIP_MATCH.has(feature.key) || WEAK_PLACE.has(feature.key)) continue;
    const token = normalizeToken(feature.value);
    if (token.length < 3) continue;
    const id = `${feature.key}:${token}`;
    const list = spellings.get(id) ?? [];
    list.push(feature);
    spellings.set(id, list);
  }
  for (const rows of spellings.values()) {
    if (points.filter((point) => point.kind === "spelling").length >= 6) break;
    const raws = [...new Set(rows.map((row) => row.value.trim()))];
    if (raws.length < 2) continue;
    points.push({
      kind: "spelling",
      value: `Gleiche normalisierte Form, unterschiedliche Schreibung: ${raws.join(" / ")}. Das ist keine neue Tatsache.`,
      method: ANALYSIS_METHOD,
      inputs: rows.map((row) => `${row.caseId}:${row.value}`).join(" | ").slice(0, 500),
      caseIds: [...new Set(rows.map((row) => row.caseId))],
    });
  }

  type Bucket = { key: string; value: string; signature: string; cases: Set<string> };
  const buckets = new Map<string, Bucket>();
  for (const feature of features) {
    if (SKIP_MATCH.has(feature.key) || WEAK_PLACE.has(feature.key)) continue;
    const token = normalizeToken(feature.value);
    if (token.length < 2) continue;
    const sig = signature(feature);
    const bucket = buckets.get(sig) ?? { key: feature.key, value: feature.value, signature: sig, cases: new Set<string>() };
    bucket.cases.add(feature.caseId);
    buckets.set(sig, bucket);
  }
  const frequent = [...buckets.values()].filter((bucket) => bucket.cases.size >= 2).sort((a, b) => a.signature.localeCompare(b.signature));
  for (const bucket of frequent) {
    if (points.filter((point) => point.kind === "combo_count").length >= 4) break;
    const rarity = rarityOf(bucket.cases.size, total);
    points.push({
      kind: "combo_count",
      value: `Merkmal „${bucket.value}“: ${rarity.text}`,
      method: ANALYSIS_METHOD,
      inputs: bucket.signature,
      caseIds: [...bucket.cases].sort(),
    });
  }
  for (let i = 0; i < frequent.length; i += 1) {
    for (let j = i + 1; j < frequent.length; j += 1) {
      if (points.filter((point) => point.kind === "combo_count").length >= 8) break;
      const left = frequent[i];
      const right = frequent[j];
      if (!left || !right) continue;
      const both = [...left.cases].filter((id) => right.cases.has(id));
      if (both.length < 2) continue;
      const rarity = rarityOf(both.length, total);
      points.push({
        kind: "combo_count",
        value: `Kombination „${left.value}“ und „${right.value}“: ${rarity.text}`,
        method: ANALYSIS_METHOD,
        inputs: `${left.signature} | ${right.signature}`,
        caseIds: both.sort(),
      });
    }
  }

  return points.slice(0, 40);
}

function sharedRows(features: StoredFeature[], ids: string[]): { signature: string; key: string; value: string }[] {
  if (ids.length < 2) return [];
  const [first, ...rest] = ids;
  if (!first) return [];
  const unique = new Map<string, StoredFeature>();
  for (const row of features) {
    if (row.caseId !== first || SKIP_MATCH.has(row.key)) continue;
    const sig = signature(row);
    if (!unique.has(sig)) unique.set(sig, row);
  }
  const shared: { signature: string; key: string; value: string }[] = [];
  for (const [sig, row] of unique) {
    if (rest.every((id) => features.some((feature) => feature.caseId === id && signature(feature) === sig))) {
      shared.push({ signature: sig, key: row.key, value: row.value });
    }
  }
  return shared;
}

function casesWithAll(features: StoredFeature[], signatures: string[]): number {
  return caseIdsOf(features).filter((caseId) => signatures.every((sig) => features.some((feature) => feature.caseId === caseId && signature(feature) === sig))).length;
}

export function explainInsight(
  insight: { caseIds: string[]; sources: string[]; status: string },
  features: StoredFeature[],
  totalCases: number,
): {
  dataClass: DataClass;
  marks: string;
  rarity: string;
  calculations: string[];
  differences: string[];
  unknown: string[];
  nextQuestions: string[];
  method: string;
} {
  const ids = insight.caseIds;
  const points = deriveDataset(features).filter((point) => point.caseIds.length > 0 && point.caseIds.every((id) => ids.includes(id)));
  const calculations = points.map((point) => point.value).slice(0, 6);
  if (!calculations.length) calculations.push("Keine Zeit-, Orts- oder Kombinationsrechnung für diese Akten. Es wurde nichts ergänzt.");

  const shared = sharedRows(features, ids);
  const basis = shared.filter((row) => !WEAK_PLACE.has(row.key));
  let rarity = "INSUFFICIENT DATA. Keine gemeinsame Merkmalsmenge für eine Häufigkeit in diesem Bestand.";
  if (basis.length) {
    const stat = rarityOf(casesWithAll(features, basis.map((row) => row.signature)), totalCases);
    const names = basis.map((row) => row.value).join(", ");
    rarity = basis.length >= 2 ? `Kombination ${names}. ${stat.text}` : `Merkmal ${names}. ${stat.text}`;
  }

  const differences: string[] = [];
  if (ids.length >= 2) {
    for (const id of ids) {
      const own = features.filter((feature) => feature.caseId === id && !SKIP_MATCH.has(feature.key));
      const seen = new Set<string>();
      for (const feature of own) {
        const sig = signature(feature);
        if (seen.has(sig)) continue;
        seen.add(sig);
        const missing = ids.filter((other) => other !== id && !features.some((item) => item.caseId === other && signature(item) === sig));
        if (!missing.length) continue;
        differences.push(`Nur in ${titleOf(features, id)}: ${feature.key} ${feature.value}.`);
        if (differences.length >= 6) break;
      }
      if (differences.length >= 6) break;
    }
  }
  if (!differences.length && ids.length >= 2) differences.push("Kein gespeichertes Merkmal, das nur in einer der verglichenen Akten steht.");

  const unknown: string[] = [];
  for (const id of ids) {
    const readable = features.some((feature) => feature.caseId === id && feature.key === "zeit" && parseStamp(feature.value));
    if (!readable) unknown.push(`Für ${titleOf(features, id)} ist kein lesbarer Zeitpunkt gespeichert.`);
    if (!cityOf(features, id)) unknown.push(`Für ${titleOf(features, id)} ist kein Ort gespeichert.`);
  }
  unknown.push("Keine Koordinaten gespeichert. Es wird keine Entfernung in Kilometern berechnet.");
  unknown.push("Interne Behördenkenntnis ist nicht Teil der geprüften Daten.");
  const hosts = sourceHosts(insight.sources);
  if (hosts.length < 2) unknown.push("Es liegen nicht zwei unabhängige Quellen-Hosts vor.");

  const nextQuestions: string[] = [];
  if (unknown.some((line) => line.includes("Zeitpunkt"))) nextQuestions.push("Welche öffentliche Quelle nennt ein lesbares Datum oder eine Uhrzeit?");
  if (unknown.some((line) => line.includes("kein Ort"))) nextQuestions.push("Welche öffentliche Quelle nennt den Ort genauer als die Akte?");
  if (hosts.length < 2) nextQuestions.push("Gibt es eine zweite unabhängige https-Quelle für dasselbe Merkmal?");
  nextQuestions.push("Gibt es eine öffentliche Quelle, die eines der gemeinsamen Merkmale ausdrücklich bestreitet?");
  if (ids.length >= 2) nextQuestions.push("Welche weitere Akte in diesem Bestand teilt die Kombination nicht?");

  const markList = [DATA_CLASS_LABEL.ai_derived];
  let dataClass: DataClass = "ai_derived";
  if (hosts.length === 1) {
    markList.push(DATA_CLASS_LABEL.single_source);
    dataClass = "single_source";
  }
  if (insight.status === "held" || insight.status === "downgraded" || hosts.length < 2) {
    markList.push(DATA_CLASS_LABEL.unverified);
    if (dataClass === "ai_derived") dataClass = "unverified";
  }
  if (rarity.includes("INSUFFICIENT DATA")) markList.push(DATA_CLASS_LABEL.insufficient);

  return {
    dataClass,
    marks: [...new Set(markList)].join(" · "),
    rarity,
    calculations,
    differences,
    unknown: unknown.slice(0, 6),
    nextQuestions: [...new Set(nextQuestions)].slice(0, 4),
    method: ANALYSIS_METHOD,
  };
}

export function relationEdges(features: StoredFeature[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: GraphEdge) => {
    const id = `${edge.from}|${edge.relation}|${edge.to}`;
    if (seen.has(id) || !edge.from || !edge.to) return;
    seen.add(id);
    edges.push(edge);
  };
  for (const point of deriveDataset(features)) {
    const titles = [...new Set(point.caseIds.map((id) => titleOf(features, id)))];
    const from = titles[0] || "Berechnung";
    let relation = "berechnet, nicht belegt";
    if (point.kind === "time_gap") relation = point.caseIds.length >= 3 ? "zeitliche Reihenfolge berechnet" : "Zeitabstand berechnet";
    if (point.kind === "place_relation") relation = "Ort verglichen, keine Kilometer";
    if (point.kind === "holiday") relation = "Feiertag nach Kalender";
    if (point.kind === "spelling") relation = "ähnliche Schreibweise, keine neue Tatsache";
    if (point.kind === "combo_count") {
      relation = point.caseIds.length >= 3
        ? "Kette über mehrere Akten, nicht belegt"
        : /In diesem Bestand selten/.test(point.value)
          ? "seltene Kombination in diesem Bestand, keine Täterschaft"
          : "Häufigkeit nur in diesem Bestand";
    }
    const to = point.kind === "place_relation" && titles[1] ? `${titles[1]}: ${point.value.slice(0, 140)}` : point.value.slice(0, 180);
    push({ from, relation, to });
  }
  const buckets = new Map<string, StoredFeature[]>();
  for (const feature of features) {
    if (SKIP_MATCH.has(feature.key) || WEAK_PLACE.has(feature.key) || feature.key === "fehlt") continue;
    const list = buckets.get(signature(feature)) ?? [];
    list.push(feature);
    buckets.set(signature(feature), list);
  }
  for (const rows of buckets.values()) {
    const hosts = sourceHosts(rows.map((row) => row.sourceUrl));
    const label = rows[0]?.value ?? "";
    if (!label) continue;
    if (hosts.length >= 2) push({ from: label, relation: "unabhängige Quellen zum selben Merkmal, nicht belegt", to: hosts.join(", ") });
    else if (hosts.length === 1) push({ from: label, relation: "gleiche Quelle", to: hosts[0] ?? "" });
  }
  for (const missing of features) {
    if (missing.key !== "fehlt") continue;
    const token = normalizeToken(missing.value);
    const other = features.find((feature) => feature.key !== "fehlt" && feature.caseId !== missing.caseId && normalizeToken(feature.value) === token);
    if (!other) continue;
    push({
      from: titleOf(features, missing.caseId),
      relation: "widersprüchliche Angaben",
      to: `${titleOf(features, other.caseId)}: ${missing.value}`,
    });
  }
  return edges.slice(0, 40);
}
