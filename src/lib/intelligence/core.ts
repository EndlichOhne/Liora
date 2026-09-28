import { changePolicy, findConflicts, findSecret, jaccard, routeTask } from "./engine.ts";
import { datasetCountLabel, detectScope, independentCount, isFollowUp, markIndependence, scanRequest } from "../research/engine.ts";

/**
 * Coordinates the existing research, knowledge and case tools.
 * It does not call a model and does not invent sources or counts.
 */

export const INTENTS = [
  "CASE_RESEARCH",
  "CROSS_CASE_RESEARCH",
  "DOCUMENT_ANALYSIS",
  "MEMORY_WRITE",
  "MEMORY_RECALL",
  "FACT_CHECK",
  "CASE_COMPARISON",
  "PERSON_RESEARCH",
  "KNOWLEDGE_GAP_ANALYSIS",
  "GENERAL",
] as const;
export type Intent = (typeof INTENTS)[number];

export const MEMORY_LAYERS = ["EPHEMERAL", "USER", "PROJECT", "CASE", "GLOBAL", "SOURCE", "DERIVED"] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];

export const MEMORY_CLASSES = ["TEMPORARY", "PREFERENCE", "FACT", "DECISION", "PROJECT", "CASE", "INSTRUCTION", "IMPORTANT", "UNKNOWN"] as const;
export type MemoryClass = (typeof MEMORY_CLASSES)[number];

export const STATEMENT_KINDS = ["FACT", "CLAIM", "ALLEGATION", "HYPOTHESIS", "INFERENCE", "UNKNOWN"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const VERDICTS = ["SUPPORTED", "WEAKLY_SUPPORTED", "CONFLICTING", "INSUFFICIENT_DATA", "REJECTED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CANNOT_ESTABLISH = "Das kann ich anhand der vorhandenen Quellen nicht feststellen.";
export const WEB_UNAVAILABLE = "Webrecherche ist aktuell nicht verfügbar.";
export const SOURCE_UNVERIFIED = "Quelle nicht ausreichend verifiziert.";
export const NOT_A_TRUTH = "Confidence ist keine Wahrheitsangabe.";
export const RARITY_NOTE = "Seltenheit bedeutet keinen Zusammenhang.";
export const NO_GUILT = "Keine Schuldzuweisung. Eine Person wird daraus nicht benannt.";
export const NOT_ABSENT = "Nicht gefunden heißt nicht, dass es nicht existiert.";

export type ContextState = {
  activeCase: string;
  activePerson: string;
  activeProject: string;
  activeResearchTask: string;
  activeSources: string[];
  activeEntities: { kind: string; value: string }[];
  activeFilters: string[];
  activeGeography: string;
  activeTimeRange: string;
  activeHypotheses: string[];
  openQuestions: string[];
  activeTopic: string;
};

export function emptyContext(): ContextState {
  return {
    activeCase: "",
    activePerson: "",
    activeProject: "",
    activeResearchTask: "",
    activeSources: [],
    activeEntities: [],
    activeFilters: [],
    activeGeography: "",
    activeTimeRange: "",
    activeHypotheses: [],
    openQuestions: [],
    activeTopic: "",
  };
}

export function detectIntent(text: string): Intent {
  const value = text.trim();
  if (/merk dir|merke dir|erinner dich daran/i.test(value)) return "MEMORY_WRITE";
  if (/was habe ich|letzte woche|früher dazu gefunden|was weißt du noch|was weisst du noch/i.test(value)) return "MEMORY_RECALL";
  if (/prüfe diese behauptung|pruefe diese behauptung|faktencheck|stimmt das/i.test(value)) return "FACT_CHECK";
  if (/vergleiche (?:diese )?fälle|vergleiche (?:diese )?faelle|vergleiche fall/i.test(value)) return "CASE_COMPARISON";
  if (/(?:recherchiere|untersuche)\s+person\b/i.test(value)) return "PERSON_RESEARCH";
  if (/was fehlt|welche information fehlt|wissenslücke|wissensluecke|offene fragen/i.test(value)) return "KNOWLEDGE_GAP_ANALYSIS";
  if (/dieses dokument|dokument analys/i.test(value)) return "DOCUMENT_ANALYSIS";
  if (/weiteren fällen|weiteren faellen|diesem merkmal|cross-case|fallvergleich/i.test(value)) return "CROSS_CASE_RESEARCH";
  if (/\bfall\b|was weißt du über|was weisst du ueber/i.test(value)) return "CASE_RESEARCH";
  return "GENERAL";
}

function clip(value: string, max: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function applyUtterance(state: ContextState, text: string): { state: ContextState; intent: Intent } {
  const intent = detectIntent(text);
  const follow = isFollowUp(text) || intent === "GENERAL" && /\b(such(?:e)? noch|jetzt ganz|noch nach)\b/i.test(text);
  const next: ContextState = {
    ...state,
    activeSources: state.activeSources.slice(0, 20),
    activeEntities: state.activeEntities.slice(0, 20),
    activeFilters: state.activeFilters.slice(0, 12),
    activeHypotheses: state.activeHypotheses.slice(0, 8),
    openQuestions: state.openQuestions.slice(0, 12),
  };
  if (!follow) {
    const scope = detectScope(text);
    if (scope !== "custom") next.activeGeography = scope;
  }
  if (/jetzt ganz deutschland|ganz deutschland|bundesweit/i.test(text)) next.activeGeography = "de";
  if (/fahrzeug|auto|kennzeichen/i.test(text)) next.activeTopic = "vehicle";
  const person = text.match(/(?:recherchiere|untersuche)\s+person\s+(.{2,140})$/i);
  if (person) next.activePerson = clip(person[1].replace(/[.,:;!?]+$/g, ""), 140);
  const fall = text.match(/\bfall\s+([A-Za-z0-9][A-Za-z0-9._-]{0,40})/i);
  if (fall) next.activeCase = fall[1].replace(/[.,:;!?]+$/g, "");
  const range = text.match(/\b(20\d{2}(?:-\d{2}-\d{2})?)\b/);
  if (range && !follow) next.activeTimeRange = range[1];
  if (/\bhypothese\b/i.test(text)) {
    const line = clip(text, 180);
    if (line && !next.activeHypotheses.includes(line)) next.activeHypotheses = [line, ...next.activeHypotheses].slice(0, 8);
  }
  const entities = scanRequest(text)
    .filter((item) => item.kind !== "scope")
    .map((item) => ({ kind: item.kind, value: item.normalizedValue }));
  for (const entity of entities) {
    if (next.activeEntities.some((item) => item.kind === entity.kind && item.value === entity.value)) continue;
    next.activeEntities = [...next.activeEntities, entity].slice(0, 20);
  }
  return { state: next, intent };
}

export function classifyMemory(text: string, hint: { project?: boolean; case?: boolean; source?: string } = {}): {
  layer: MemoryLayer;
  klass: MemoryClass;
  durable: boolean;
  reason: string;
} {
  const value = text.trim();
  if (!value || findSecret(value)) {
    return { layer: "EPHEMERAL", klass: "UNKNOWN", durable: false, reason: "Nichts Dauerhaftes. Kein Schlüssel und kein leerer Text." };
  }
  if (/merk dir nicht|nur für diesen chat|nur fuer diesen chat|vorübergehend|voruebergehend/i.test(value)) {
    return { layer: "EPHEMERAL", klass: "TEMPORARY", durable: false, reason: "Nur für dieses Gespräch." };
  }
  if (/ab jetzt immer|künftig immer|kuenftig immer|mach das zukünftig/i.test(value)) {
    return { layer: "USER", klass: "PREFERENCE", durable: true, reason: "Ausdrückliche Präferenz." };
  }
  if (/anweisung|antwortstil|immer auf deutsch/i.test(value)) {
    return { layer: "USER", klass: "INSTRUCTION", durable: true, reason: "Ausdrückliche Arbeitsanweisung." };
  }
  if (/entschieden|beschluss|wir machen/i.test(value)) {
    return { layer: hint.project ? "PROJECT" : "USER", klass: "DECISION", durable: true, reason: "Als Entscheidung gekennzeichnet." };
  }
  if (hint.case || /\bfall\b/i.test(value)) {
    return { layer: "CASE", klass: "CASE", durable: false, reason: "Fallwissen bleibt an der Akte und wird hier nicht als Nutzerfakt gespeichert." };
  }
  if (hint.project || /\bprojekt\b/i.test(value)) {
    return { layer: "PROJECT", klass: "PROJECT", durable: true, reason: "Projektnotiz." };
  }
  if (/wichtig|nicht vergessen/i.test(value)) {
    return { layer: "USER", klass: "IMPORTANT", durable: true, reason: "Ausdrücklich als wichtig markiert." };
  }
  if (/\bfakt\b|belegt/i.test(value)) {
    if (!hint.source?.trim()) {
      return { layer: "EPHEMERAL", klass: "FACT", durable: false, reason: "Ohne Quelle kein dauerhafter Fakt." };
    }
    return { layer: "SOURCE", klass: "FACT", durable: true, reason: "Mit genannter Quelle, Status bleibt ungeprüft." };
  }
  return { layer: "EPHEMERAL", klass: "TEMPORARY", durable: false, reason: "Nicht als dauerhafte Erinnerung erkannt." };
}

export function statementKind(input: { text: string; evidence: string }): { kind: StatementKind; label: string; mayPromoteToFact: boolean } {
  const text = input.text.trim();
  const evidence = input.evidence.trim();
  if (/\b(muster|ähnlich|aehnlich|inferenz|abgeleitet)\b/i.test(text) || evidence === "pattern") {
    return { kind: "INFERENCE", label: "INFERENCE", mayPromoteToFact: false };
  }
  if (evidence === "hypothesis" || evidence === "speculation" || /\bhypothese\b/i.test(text)) {
    return { kind: "HYPOTHESIS", label: "HYPOTHESIS", mayPromoteToFact: false };
  }
  if (evidence === "reported" || /medium berichtet|zeitung|meldet/i.test(text)) {
    return { kind: "CLAIM", label: "MEDIA_REPORTED", mayPromoteToFact: false };
  }
  if (evidence === "alleged" || /gewesen sein soll|beteiligt gewesen/i.test(text)) {
    return { kind: "ALLEGATION", label: "ALLEGATION", mayPromoteToFact: false };
  }
  if (evidence === "court") return { kind: "FACT", label: "COURT_ESTABLISHED", mayPromoteToFact: true };
  if (evidence === "official" || evidence === "documented") return { kind: "FACT", label: evidence === "official" ? "OFFICIAL_REPORTED" : "DOCUMENTED", mayPromoteToFact: false };
  if (evidence === "unconfirmed") return { kind: "UNKNOWN", label: "UNKNOWN", mayPromoteToFact: false };
  return { kind: "UNKNOWN", label: "UNKNOWN", mayPromoteToFact: false };
}

export function explainConfidence(independentSources: number, strongSources: number): { level: ConfidenceLevel; reason: string } {
  const note = NOT_A_TRUTH;
  if (!Number.isInteger(independentSources) || independentSources < 1 || strongSources < 0) {
    return { level: "UNKNOWN", reason: `Keine ausreichende Evidenz. ${note}` };
  }
  if (independentSources >= 2 && strongSources >= 1) {
    return { level: "HIGH", reason: `Mehrere unabhängige Quellen, darunter mindestens eine hochwertige. ${note}` };
  }
  if (independentSources >= 2) return { level: "MEDIUM", reason: `Mehrere Quellen, aber keine hochwertige. ${note}` };
  if (strongSources >= 1) return { level: "MEDIUM", reason: `Eine hochwertige Quelle, keine zweite unabhängige Bestätigung. ${note}` };
  return { level: "LOW", reason: `Eine sekundäre Quelle. ${note}` };
}

export function analyzedFeatureCount(present: number, analyzed: number): string {
  const base = datasetCountLabel(present, analyzed);
  if (base === "INSUFFICIENT DATA") return "INSUFFICIENT DATA";
  return `Merkmal wurde in ${present} von ${analyzed} analysierten Fällen dokumentiert. Keine Aussage über alle Fälle.`;
}

export function rareCombo(input: { keys: string[]; casesWithAll: number; casesAnalyzed: number }): { label: "RARE_PATTERN" | "POTENTIAL_LINK" | "INSUFFICIENT_DATA"; note: string } {
  const keys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))];
  if (keys.length < 3 || input.casesAnalyzed < 1) {
    return { label: "INSUFFICIENT_DATA", note: "Zu wenige gespeicherte Merkmale für eine Kombination." };
  }
  if (input.casesWithAll >= 2) {
    return { label: "POTENTIAL_LINK", note: `Die Kombination liegt in ${input.casesWithAll} der ${input.casesAnalyzed} analysierten Fälle. ${RARITY_NOTE} ${NO_GUILT}` };
  }
  return { label: "RARE_PATTERN", note: `Die Kombination ist in diesem Bestand selten. ${RARITY_NOTE}` };
}

export function absenceKind(input: { reviewed: boolean; explicitDenial: boolean }): { status: "NOT_FOUND_IN_REVIEWED_SOURCES" | "CONFIRMED_ABSENT" | "NOT_REVIEWED"; note: string } {
  if (input.explicitDenial) return { status: "CONFIRMED_ABSENT", note: "Eine gespeicherte Angabe verneint das ausdrücklich." };
  if (input.reviewed) return { status: "NOT_FOUND_IN_REVIEWED_SOURCES", note: NOT_ABSENT };
  return { status: "NOT_REVIEWED", note: "Es wurde nichts geprüft. Das ist weder ein Fund noch eine bestätigte Abwesenheit." };
}

export function gapPlan(missing: string[]): { question: string; next: string }[] {
  const plans: { question: string; next: string }[] = [];
  for (const item of missing) {
    if (/DATE MISSING|TIME MISSING|Tatzeit/i.test(item)) {
      plans.push({ question: "Exaktes Tatzeitfenster fehlt.", next: "Suche nach öffentlich verfügbaren Angaben zum Zeitpunkt. Nichts wird geschätzt." });
    } else if (/LOCATION MISSING/i.test(item)) {
      plans.push({ question: "Ort fehlt.", next: "Nur den Ort aus einer gespeicherten Quelle übernehmen." });
    } else if (/VEHICLE/i.test(item)) {
      plans.push({ question: "Fahrzeugangabe fehlt.", next: "Im Bestand und, nur wenn freigegeben, in öffentlichen Quellen nach dem Fahrzeug suchen." });
    } else if (/COURT SOURCE MISSING/i.test(item)) {
      plans.push({ question: "Gerichtsquelle fehlt.", next: "Suche nach öffentlich verfügbaren Gerichtsunterlagen." });
    } else if (/SECOND SOURCE|SOURCE MISSING/i.test(item)) {
      plans.push({ question: "Eine weitere unabhängige Quelle fehlt.", next: "Keine Kopie der ersten Quelle als zweite Bestätigung zählen." });
    }
  }
  const seen = new Set<string>();
  return plans.filter((item) => (seen.has(item.question) ? false : (seen.add(item.question), true)));
}

export function researchOutline(text: string): { name: string; note: string; status: "planned" }[] {
  const complex = /recherchiere fall|verbindung|ähnlichen fällen|aehnlichen faellen/i.test(text);
  if (!complex) return [];
  const names = [
    "Fall identifizieren",
    "Schreibvarianten suchen",
    "Offizielle öffentliche Quellen suchen",
    "Gerichtsquellen suchen",
    "Seriöse Medien suchen",
    "Dokumente sammeln",
    "Fakten extrahieren",
    "Timeline erstellen",
    "Personen extrahieren",
    "Orte extrahieren",
    "Fahrzeuge und Objekte extrahieren",
    "Merkmale normalisieren",
    "Ähnliche Fälle im Bestand suchen",
    "Quellen vergleichen",
    "Gegenargumente suchen",
    "Ergebnis erstellen",
  ];
  return names.map((name) => ({
    name,
    note: "Geplant. Noch nicht ausgeführt. Eine Websuche startet nur, wenn sie eigens freigegeben wird.",
    status: "planned" as const,
  }));
}

export function mapResearchStatus(status: string): "PLANNED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN" {
  if (status === "queued") return "PLANNED";
  if (status === "running") return "RUNNING";
  if (status === "paused") return "WAITING";
  if (status === "completed") return "COMPLETED";
  if (status === "failed") return "FAILED";
  if (status === "cancelled") return "CANCELLED";
  return "UNKNOWN";
}

export function incrementalDecision(input: { knownSourceIds: string[]; incomingSourceIds: string[]; sameFingerprint: boolean }): "NO_NEW_DATA" | "NEW_DATA" {
  if (input.sameFingerprint) return "NO_NEW_DATA";
  const known = new Set(input.knownSourceIds);
  const fresh = input.incomingSourceIds.filter((id) => id && !known.has(id));
  return fresh.length ? "NEW_DATA" : "NO_NEW_DATA";
}

export function sourceChange(beforeHash: string, afterHash: string): "UNCHANGED" | "SOURCE_CHANGED" | "UNKNOWN" {
  if (!beforeHash.trim() || !afterHash.trim()) return "UNKNOWN";
  return beforeHash === afterHash ? "UNCHANGED" : "SOURCE_CHANGED";
}

export function nextFindingVersion(
  previous: { version: number; value: string } | null,
  next: { value: string; reason: string; source: string },
): { action: "keep"; version: number } | { action: "append"; version: number; previousValue: string; newValue: string; reason: string; source: string; keepPrevious: true } | { action: "reject"; reason: string } {
  const value = next.value.trim();
  const reason = next.reason.trim();
  if (!value || !reason) return { action: "reject", reason: "Ohne neuen Text und Grund keine Version." };
  if (findSecret(value) || findSecret(reason)) return { action: "reject", reason: "Schlüssel werden nicht versioniert." };
  const prior = previous?.value ?? "";
  if (previous && prior === value) return { action: "keep", version: previous.version };
  return {
    action: "append",
    version: (previous?.version ?? 0) + 1,
    previousValue: prior,
    newValue: value.slice(0, 2000),
    reason: reason.slice(0, 500),
    source: next.source.trim().slice(0, 500),
    keepPrevious: true,
  };
}

export function verdictFromNotes(input: { killed: boolean; conflictNotes: number; shared: number; independentSources: number; official: boolean }): { verdict: Verdict; note: string } {
  if (input.killed) return { verdict: "REJECTED", note: `Gespeichertes Gegenargument. ${NO_GUILT}` };
  if (input.conflictNotes > 0) return { verdict: "CONFLICTING", note: `Die gespeicherten Angaben widersprechen sich. ${NO_GUILT}` };
  if (input.shared < 1 || input.independentSources < 1) return { verdict: "INSUFFICIENT_DATA", note: "Zu wenig gespeichertes Material." };
  if (input.official && input.independentSources >= 2 && input.shared >= 2) {
    return { verdict: "SUPPORTED", note: `Mehrere unabhängige hochwertige Quellen tragen dieselben Merkmale. ${NO_GUILT}` };
  }
  if (input.independentSources >= 2 && input.shared >= 1) return { verdict: "WEAKLY_SUPPORTED", note: `Es gibt Gemeinsamkeiten, aber keine ausreichende hochwertige Bestätigung. ${NO_GUILT}` };
  return { verdict: "INSUFFICIENT_DATA", note: "Eine einzelne Übereinstimmung trägt keinen Zusammenhang." };
}

export function reasonFromStored(input: { known: string[]; unknown: string[]; evidence: string[] }): { conclusion: string; missing: string } {
  const known = input.known.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const unknown = input.unknown.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const evidence = input.evidence.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  if (!known.length) return { conclusion: CANNOT_ESTABLISH, missing: unknown[0] ?? "" };
  const base = evidence.length ? evidence.join(", ") : known.join(", ");
  const missing = unknown[0] ?? "";
  return {
    conclusion: missing ? `Diese Schlussfolgerung basiert auf ${base}. ${missing} fehlt noch.` : `Diese Schlussfolgerung basiert auf ${base}.`,
    missing,
  };
}

export type AgentResult = {
  agent: string;
  status: "ok" | "empty" | "denied" | "skipped";
  summary: string;
  facts: string[];
  claims: string[];
  sources: string[];
  conflicts: string[];
  openQuestions: string[];
  derivedInsights: string[];
  nextSteps: string[];
  errors: string[];
};

export function coreBoundary(text: string, actorId: string, ownerId: string): { ok: true } | { ok: false; reason: string } {
  if (!actorId || actorId !== ownerId) return { ok: false, reason: "Nicht verfügbar." };
  if (findSecret(text)) return { ok: false, reason: "Schlüssel werden nicht verarbeitet." };
  if (/auth\s+(abschalten|deaktivieren|umgehen)|security\s+(off|disable)|api[- ]?key\s+aus|row level security\s+aus/i.test(text)) {
    return { ok: false, reason: "Sicherheitsregeln werden nicht geändert." };
  }
  return { ok: true };
}

export function learningAllowed(action: string): boolean {
  const blocked = ["disable_security", "change_auth", "replace_production", "drop_schema", "raise_privilege"];
  if (blocked.includes(action)) return false;
  const allowed = ["store_error", "store_strategy", "store_pattern", "benchmark", "prompt_proposal", "routing_proposal", "code_proposal"];
  if (!allowed.includes(action)) return false;
  return changePolicy(action).mutatesProduction === false;
}

export function observe(input: { taskId: string; agent: string; step: string; durationMs: number; status: string; sourceCount: number; findingCount: number; errorCount: number }) {
  return {
    taskId: input.taskId,
    agent: input.agent,
    step: input.step,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    status: input.status,
    sourceCount: Math.max(0, input.sourceCount),
    findingCount: Math.max(0, input.findingCount),
    errorCount: Math.max(0, input.errorCount),
  };
}

export type CoreSource = { id: string; url: string; title: string; kind: string; note?: string };
export type CoreKnowledge = { id: string; statement: string; status: string; evidence?: string };
export type CoreMemory = { id: string; content: string; category: string };

export function orchestrate(input: {
  actorId: string;
  ownerId: string;
  text: string;
  context: ContextState;
  memories: CoreMemory[];
  knowledge: CoreKnowledge[];
  sources: CoreSource[];
  featurePresence: { analyzed: number; present: number };
  webEnabled: boolean;
}): {
  denied: boolean;
  reason: string;
  intent: Intent;
  context: ContextState;
  stages: { name: string; note: string }[];
  known: string[];
  unknown: string[];
  conflicts: string[];
  sources: { id: string; title: string; independence: string }[];
  facts: string[];
  claims: string[];
  derived: string[];
  openQuestions: string[];
  nextSteps: string[];
  conclusion: string;
  reply: string;
  confidence: { level: ConfidenceLevel; reason: string };
  memory: ReturnType<typeof classifyMemory>;
  agents: string[];
  simple: boolean;
} {
  const gate = coreBoundary(input.text, input.actorId, input.ownerId);
  if (!gate.ok) {
    return {
      denied: true,
      reason: gate.reason,
      intent: "GENERAL",
      context: input.context,
      stages: [{ name: "Grenze", note: gate.reason }],
      known: [],
      unknown: [],
      conflicts: [],
      sources: [],
      facts: [],
      claims: [],
      derived: [],
      openQuestions: [],
      nextSteps: [],
      conclusion: "",
      reply: gate.reason,
      confidence: { level: "UNKNOWN", reason: NOT_A_TRUTH },
      memory: classifyMemory(""),
      agents: [],
      simple: true,
    };
  }
  const applied = applyUtterance(input.context, input.text);
  const route = routeTask(input.text);
  const ownedKnowledge = input.actorId === input.ownerId ? input.knowledge : [];
  const ownedMemories = input.actorId === input.ownerId ? input.memories : [];
  const known = ownedKnowledge
    .filter((item) => item.status !== "rejected" && jaccard(input.text, item.statement) >= 0.18)
    .slice(0, 5);
  const recalled = applied.intent === "MEMORY_RECALL"
    ? ownedMemories.filter((item) => jaccard(input.text, item.content) >= 0.12).slice(0, 5)
    : [];
  const marked = markIndependence(input.sources.map((source) => ({ ...source, note: source.note ?? "" }))).slice(0, 40);
  const relevant = marked.filter((source) => {
    if (applied.state.activeSources.includes(source.id)) return true;
    return jaccard(input.text, `${source.title} ${source.note ?? ""}`) >= 0.12;
  }).slice(0, 12);
  const independenceCount = independentCount(relevant);
  const strong = relevant.filter((source) => source.kind === "official" || source.kind === "court" || source.kind === "documented").length;
  const confidence = explainConfidence(independenceCount, Math.min(strong, independenceCount));
  const facts: string[] = [];
  const claims: string[] = [];
  const derived: string[] = [];
  for (const item of known) {
    const kind = statementKind({ text: item.statement, evidence: item.evidence ?? "" });
    if (kind.kind === "FACT") facts.push(item.statement);
    else if (kind.kind === "INFERENCE" || kind.kind === "HYPOTHESIS") derived.push(item.statement);
    else claims.push(item.statement);
  }
  const conflicts = known.flatMap((item) => findConflicts(item.statement, ownedKnowledge.filter((other) => other.id !== item.id).map((other) => ({ id: other.id, statement: other.statement, status: "current" as const }))).map((hit) => hit.statement)).slice(0, 5);
  const unknown: string[] = [];
  if (applied.state.activeTopic === "vehicle" && !/fahrzeug/i.test(known.map((item) => item.statement).join(" "))) unknown.push("VEHICLE INFORMATION MISSING");
  if (applied.intent === "CASE_RESEARCH" && !applied.state.activeTimeRange) unknown.push("DATE MISSING");
  if (relevant.length === 1) unknown.push("SECOND SOURCE MISSING");
  const questions = gapPlan(unknown);
  const reasoned = reasonFromStored({
    known: [...facts, ...claims.map((item) => `Behauptung: ${item}`), ...recalled.map((item) => item.content)].slice(0, 5),
    unknown: questions.map((item) => item.question),
    evidence: relevant.map((source) => source.title || source.url).filter(Boolean),
  });
  const simple = applied.intent === "GENERAL" && input.text.trim().length < 80 && route.mode === "fast";
  const parts: string[] = [];
  if (!input.webEnabled && (applied.intent === "CASE_RESEARCH" || applied.intent === "PERSON_RESEARCH" || applied.intent === "CROSS_CASE_RESEARCH") && relevant.length === 0) {
    parts.push(WEB_UNAVAILABLE);
  }
  if (relevant.some((source) => source.independenceStatus === "unknown")) parts.push(SOURCE_UNVERIFIED);
  if (simple && facts[0]) parts.push(facts[0]);
  else if (simple && recalled[0]) parts.push(recalled[0].content);
  else parts.push(reasoned.conclusion);
  if (!simple && input.featurePresence.analyzed > 0 && (applied.intent === "CROSS_CASE_RESEARCH" || applied.intent === "CASE_COMPARISON")) {
    parts.push(analyzedFeatureCount(input.featurePresence.present, input.featurePresence.analyzed));
  }
  const reply = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const stages = [
    { name: "Kontext", note: applied.state.activeCase ? `Akte ${applied.state.activeCase}` : "Keine aktive Akte im Kontext." },
    { name: "Absicht", note: applied.intent },
    { name: "Entitäten", note: applied.state.activeEntities.length ? `${applied.state.activeEntities.length} aus dem Text` : "Keine Entität im Text." },
    { name: "Erinnerung", note: recalled.length ? `${recalled.length} Treffer im eigenen Speicher` : "Kein Erinnerungstreffer." },
    { name: "Wissen", note: known.length ? `${known.length} gespeicherte Aussagen` : "Keine passende gespeicherte Aussage." },
    { name: "Plan", note: researchOutline(input.text).length ? "Plan erstellt, nicht ausgeführt." : "Kein mehrstufiger Plan nötig." },
    { name: "Agenten", note: route.agents.length ? route.agents.join(", ") : "Kein Spezialagent." },
    { name: "Quellen", note: relevant.length ? `${relevant.length} gespeichert, ${independenceCount} unabhängig` : "Keine passende gespeicherte Quelle." },
    { name: "Prüfung", note: confidence.reason },
    { name: "Widerspruch", note: conflicts.length ? `${conflicts.length} gespeicherte Spannung` : "Kein gespeicherter Widerspruch." },
    { name: "Schluss", note: reasoned.conclusion },
  ];
  return {
    denied: false,
    reason: "",
    intent: applied.intent,
    context: { ...applied.state, openQuestions: questions.map((item) => item.question) },
    stages,
    known: known.map((item) => item.statement),
    unknown: questions.map((item) => item.question),
    conflicts,
    sources: relevant.map((source) => ({ id: source.id, title: source.title || source.url || "Ohne Titel", independence: source.independenceStatus })),
    facts,
    claims,
    derived,
    openQuestions: questions.map((item) => item.question),
    nextSteps: questions.map((item) => item.next),
    conclusion: reasoned.conclusion,
    reply,
    confidence,
    memory: classifyMemory(input.text, { source: relevant[0]?.url }),
    agents: route.agents,
    simple,
  };
}
