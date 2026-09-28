import { getPglite, getSql } from "@/lib/db";
import { dbSource } from "@/lib/db";
import { saveMemory } from "@/lib/data.server";
import { findSecret } from "@/lib/intelligence/engine";
import {
  applyUtterance,
  emptyContext,
  nextFindingVersion,
  orchestrate,
  type ContextState,
  type MemoryClass,
} from "@/lib/intelligence/core";
import { countPresence, datasetPhrase, linksFromFeatures, versionChange, assignProvenance, independentOrigins } from "@/lib/intelligence/hardening";
import { persistencePlan } from "@/lib/persistence";
import type { MemoryCategory } from "@/lib/domain";
import { writeAudit } from "@/lib/security/log";
import fs from "node:fs";
import path from "node:path";

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

export function parseContext(value: unknown): ContextState {
  const empty = emptyContext();
  const raw = typeof value === "string" ? safeJson(value) : value;
  if (!raw || typeof raw !== "object") return empty;
  const row = raw as Partial<ContextState>;
  return {
    activeCase: text(row.activeCase).slice(0, 80),
    activePerson: text(row.activePerson).slice(0, 140),
    activeProject: text(row.activeProject).slice(0, 80),
    activeResearchTask: text(row.activeResearchTask).slice(0, 80),
    activeSources: list(row.activeSources, 20),
    activeEntities: Array.isArray(row.activeEntities)
      ? row.activeEntities.slice(0, 20).map((item) => ({ kind: text(item.kind).slice(0, 40), value: text(item.value).slice(0, 180) })).filter((item) => item.value)
      : [],
    activeFilters: list(row.activeFilters, 12),
    activeGeography: text(row.activeGeography).slice(0, 40),
    activeTimeRange: text(row.activeTimeRange).slice(0, 40),
    activeHypotheses: list(row.activeHypotheses, 8),
    openQuestions: list(row.openQuestions, 12),
    activeTopic: text(row.activeTopic).slice(0, 40),
    recentTurns: Array.isArray(row.recentTurns)
      ? row.recentTurns.slice(-40).map((item) => ({ role: text(item.role) === "assistant" ? "assistant" : "user", text: text(item.text).slice(0, 280) })).filter((item) => item.text)
      : [],
    lastDecisions: list(row.lastDecisions, 8),
    activeInstruction: text(row.activeInstruction).slice(0, 200),
  };
}

function list(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item).trim()).filter(Boolean).slice(0, max);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function loadContext(userId: string): Promise<ContextState> {
  const db = await getSql();
  const rows = await db<{ state_json: unknown }>`select state_json from ci_context_state where user_id = ${userId} limit 1`;
  return parseContext(rows[0]?.state_json);
}

export async function saveContext(userId: string, state: ContextState) {
  const db = await getSql();
  const payload = JSON.stringify(parseContext(state));
  await db`
    insert into ci_context_state (user_id, state_json)
    values (${userId}, ${payload}::jsonb)
    on conflict (user_id) do update set state_json = ${payload}::jsonb, updated_at = now()
  `;
}

export async function rememberContext(userId: string, utterance: string, priorAnswer = "") {
  if (!userId || !utterance.trim() || findSecret(utterance)) return;
  let current = await loadContext(userId);
  if (current.recentTurns.length === 0) current = await backfillTurns(userId, current, utterance);
  const withAnswer = priorAnswer.trim() && !findSecret(priorAnswer)
    ? {
        ...current,
        recentTurns: [...current.recentTurns, { role: "assistant", text: priorAnswer.replace(/\s+/g, " ").trim().slice(0, 280) }].slice(-40),
      }
    : current;
  const next = applyUtterance(withAnswer, utterance);
  await saveContext(userId, next.state);
}

async function backfillTurns(userId: string, current: ContextState, utterance: string): Promise<ContextState> {
  const db = await getSql();
  const rows = await db<{ role: string; content: string }>`
    select role, content from messages where user_id = ${userId} order by created_at desc limit 40
  `;
  const turns = rows.slice().reverse();
  let state = current;
  turns.forEach((row, index) => {
    const body = text(row.content).replace(/\s+/g, " ").trim();
    if (!body || findSecret(body)) return;
    const last = index === turns.length - 1 && row.role === "user" && body === utterance.trim();
    if (last) return;
    if (row.role === "assistant") {
      state = { ...state, recentTurns: [...state.recentTurns, { role: "assistant", text: body.slice(0, 280) }].slice(-40) };
      return;
    }
    state = applyUtterance(state, body).state;
  });
  return state;
}

export async function resolveOwnedCase(userId: string, token: string): Promise<string | null> {
  const needle = token.trim().slice(0, 80);
  if (!needle) return null;
  const db = await getSql();
  const rows = await db<{ id: string }>`
    select id from ci_cases
    where user_id = ${userId} and (id = ${needle} or lower(code) = lower(${needle}))
    limit 1
  `;
  return rows[0]?.id ?? null;
}

const MEMORY_CATEGORY: Partial<Record<MemoryClass, MemoryCategory>> = {
  PREFERENCE: "preference",
  INSTRUCTION: "instruction",
  DECISION: "knowledge",
  PROJECT: "project",
  IMPORTANT: "long_term",
  FACT: "fact",
};

export async function runCore(userId: string, utterance: string) {
  const started = Date.now();
  const text = utterance.trim().slice(0, 2000);
  const context = await loadContext(userId);
  const db = await getSql();
  const [knowledge, sources, memories, features] = await Promise.all([
    db<{ id: string; statement: string; status: string }>`
      select id, statement, status from ci_knowledge where user_id = ${userId} order by updated_at desc limit 40
    `,
    db<{ id: string; url: string; title: string; kind: string; note: string }>`
      select id, url, title, kind, note from ci_sources where user_id = ${userId} order by created_at desc limit 40
    `,
    db<{ id: string; content: string; category: string }>`
      select id, content, category from memories where user_id = ${userId} order by updated_at desc limit 40
    `,
    db<{ case_id: string; feature_value: string }>`
      select case_id, feature_value from ci_case_features where user_id = ${userId} order by created_at desc limit 80
    `,
  ]);
  const presence = countPresence(
    text,
    features.map((row) => ({ caseId: row.case_id, value: row.feature_value })),
  );
  const result = orchestrate({
    actorId: userId,
    ownerId: userId,
    text,
    context,
    memories,
    knowledge,
    sources,
    featurePresence: { analyzed: presence.analyzed, present: presence.present },
    webEnabled: false,
  });
  if (!result.denied) await saveContext(userId, result.context);
  const category = MEMORY_CATEGORY[result.memory.klass];
  let memoryId = "";
  if (!result.denied && result.intent === "MEMORY_WRITE" && result.memory.durable && category) {
    memoryId = await saveMemory(userId, {
      category,
      title: result.memory.klass,
      content: text,
      source: result.sources[0]?.title ?? "",
      confidence: result.memory.klass === "FACT" ? "low" : "",
    });
  }
  if (result.denied) await writeAudit(userId, "PERMISSION_DENIED", "intelligence", "denied");
  const counted = await db<{ n: number }>`select count(distinct case_id) as n from ci_case_features where user_id = ${userId}`;
  const size = Number(counted[0]?.n ?? 0);
  const taskId = crypto.randomUUID();
  const summary = result.denied ? result.reason : `${result.intent}. ${result.conclusion}`.slice(0, 400);
  await db`
    insert into ci_runs (id, user_id, agent, mode, tier, status, summary, detail, duration_ms, finished_at)
    values (
      ${taskId}, ${userId}, 'orchestrator', 'deep', 'normal', ${result.denied ? "denied" : "completed"},
      ${summary},
      ${JSON.stringify({
        step: result.stages.at(-1)?.name ?? "",
        sourceCount: result.sources.length,
        findingCount: result.facts.length + result.claims.length,
        errorCount: result.denied ? 1 : 0,
        intent: result.intent,
      })}::jsonb,
      ${Date.now() - started},
      now()
    )
  `;
  return {
    taskId,
    memoryId,
    datasetPhrase: datasetPhrase(presence.present, size > 0 ? { size, name: "Fälle mit gespeichertem Merkmal" } : null),
    semanticOnly: presence.semanticOnly,
    possibleOnly: presence.possibleOnly,
    ...result,
  };
}

export async function listCoreGraph(userId: string) {
  const db = await getSql();
  const [people, sources] = await Promise.all([
    db<{ person_id: string; relation: string; case_id: string; source_id: string }>`
      select person_id, relation, case_id, source_id from ci_person_cases
      where user_id = ${userId} order by created_at desc limit 40
    `,
    db<{ id: string; case_id: string; title: string }>`
      select id, case_id, title from ci_sources
      where user_id = ${userId} and case_id is not null
      order by created_at desc limit 40
    `,
  ]);
  return [
    ...people.map((row) => ({ from: "person", fromId: row.person_id, relation: row.relation, to: "case", toId: row.case_id, sourceId: row.source_id })),
    ...sources.map((row) => ({ from: "source", fromId: row.id, relation: "dokumentiert", to: "case", toId: text(row.case_id), sourceId: row.id })),
  ];
}

export async function appendFindingVersion(userId: string, input: { findingId: string; value: string; reason: string; source: string }) {
  const db = await getSql();
  const owned = await db<{ id: string }>`select id from ci_knowledge where id = ${input.findingId} and user_id = ${userId} limit 1`;
  if (!owned[0]) return { ok: false as const, note: "Nicht gefunden." };
  const prior = await db<{ version: number; new_value: string }>`
    select version, new_value from ci_finding_versions
    where user_id = ${userId} and finding_id = ${input.findingId}
    order by version desc limit 1
  `;
  const decision = nextFindingVersion(prior[0] ? { version: Number(prior[0].version), value: prior[0].new_value } : null, input);
  if (decision.action === "reject") return { ok: false as const, note: decision.reason };
  if (decision.action === "keep") return { ok: true as const, note: "Merkmale unverändert. Keine neue Bewertung.", version: decision.version, change: "CONFIRMED" as const };
  const change = versionChange(decision.previousValue, decision.newValue);
  if (prior[0]) {
    await db`
      update ci_finding_versions set status = 'older'
      where user_id = ${userId} and finding_id = ${input.findingId} and status = 'current'
    `;
  }
  await db`
    insert into ci_finding_versions (id, user_id, finding_id, version, previous_value, new_value, reason, source_note, status, change_kind)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.findingId}, ${decision.version}, ${decision.previousValue},
      ${decision.newValue}, ${decision.reason}, ${decision.source || "SOURCE MISSING"}, 'current', ${change}
    )
  `;
  return { ok: true as const, note: "Neue Version gespeichert. Die vorherige bleibt erhalten.", version: decision.version, change };
}

export async function loadCoreDesk(userId: string) {
  const db = await getSql();
  const [context, runs, versions, graph] = await Promise.all([
    loadContext(userId),
    db<{ id: string; status: string; summary: string; detail: unknown; started_at: unknown }>`
      select id, status, summary, detail, started_at from ci_runs
      where user_id = ${userId} and agent = 'orchestrator'
      order by started_at desc limit 6
    `,
    db<{ finding_id: string; version: number; previous_value: string; new_value: string; reason: string; source_note: string; status: string; change_kind: string; created_at: unknown }>`
      select finding_id, version, previous_value, new_value, reason, source_note, status, change_kind, created_at
      from ci_finding_versions where user_id = ${userId}
      order by created_at desc limit 8
    `,
    listCoreGraph(userId),
  ]);
  const storage = await storageReport();
  await persistProvenance(userId);
  const counted = await db<{ n: number }>`select count(distinct case_id) as n from ci_case_features where user_id = ${userId}`;
  const size = Number(counted[0]?.n ?? 0);
  const featureRows = await db<{ case_id: string; feature_key: string; feature_value: string; source_url: string }>`
    select case_id, feature_key, feature_value, source_url from ci_case_features
    where user_id = ${userId} order by created_at desc limit 80
  `;
  const links = linksFromFeatures(featureRows.map((row) => ({
    caseId: row.case_id,
    feature: row.feature_key,
    normalizedValue: row.feature_value,
    sourceId: row.source_url,
  })));
  return {
    context,
    runs: runs.map((row) => ({
      id: row.id,
      status: row.status,
      summary: row.summary,
      detail: typeof row.detail === "object" && row.detail ? row.detail : {},
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : text(row.started_at),
    })),
    versions: versions.map((row) => ({
      findingId: row.finding_id,
      version: Number(row.version),
      previousValue: row.previous_value,
      newValue: row.new_value,
      reason: row.reason,
      source: row.source_note,
      status: row.status,
      change: row.change_kind || "CHANGED",
    })),
    graph,
    dataset: {
      size,
      phrase: size > 0 ? `${size} Fälle mit mindestens einem gespeicherten Merkmal. Keine Aussage über alle Fälle.` : "NICHT VERFÜGBAR",
    },
    links,
    storage,
    notConfigured: [
      "Einbettungs-Vektorsuche ist nicht eingerichtet. Semantik ist hier nur eine feste Slot-Regel, kein Modell.",
      "Diese Ansicht startet keine Websuche.",
      "Produktionscode wird nicht selbst geändert.",
      storage.backup === "NOT_CONFIGURED" ? storage.backupNote : "",
    ].filter(Boolean),
  };
}

async function persistProvenance(userId: string) {
  const db = await getSql();
  const rows = await db<{ id: string; url: string; title: string; note: string; kind: string }>`
    select id, url, title, note, kind from ci_sources where user_id = ${userId} order by created_at desc limit 40
  `;
  const marked = assignProvenance(rows);
  for (const row of marked) {
    await db`
      update ci_sources
      set canonical_source_id = ${row.canonicalSourceId},
          source_parent_id = ${row.sourceParentId},
          source_origin = ${row.sourceOrigin},
          source_relationship = ${row.sourceRelationship},
          duplicate_group = ${row.duplicateGroup},
          independence_status = ${row.independenceStatus}
      where id = ${row.id} and user_id = ${userId}
    `;
  }
  return independentOrigins(marked);
}

export async function saveDocumentedLinks(userId: string) {
  const db = await getSql();
  const featureRows = await db<{ case_id: string; feature_key: string; feature_value: string; source_url: string }>`
    select case_id, feature_key, feature_value, source_url from ci_case_features
    where user_id = ${userId} order by created_at desc limit 80
  `;
  const owned = await db<{ id: string }>`select id from ci_cases where user_id = ${userId}`;
  const own = new Set(owned.map((row) => row.id));
  const links = linksFromFeatures(featureRows.map((row) => ({
    caseId: row.case_id,
    feature: row.feature_key,
    normalizedValue: row.feature_value,
    sourceId: row.source_url,
  }))).filter((link) => link.storable && own.has(link.leftCaseId) && own.has(link.rightCaseId) && !forbiddenLink(link.note));
  if (!links.length) return { saved: 0, note: "Keine dokumentierte Verknüpfung ohne Widerspruch." };
  let saved = 0;
  for (const link of links) {
    const existing = await db<{ id: string }>`
      select id from ci_case_links
      where user_id = ${userId} and left_case_id = ${link.leftCaseId} and right_case_id = ${link.rightCaseId} and link_kind = ${link.linkKind}
      limit 1
    `;
    if (existing[0]) continue;
    await db`
      insert into ci_case_links (
        id, user_id, left_case_id, right_case_id, link_kind, link_strength,
        supporting_features, contradicting_features, source_count, independent_source_count, note
      ) values (
        ${crypto.randomUUID()}, ${userId}, ${link.leftCaseId}, ${link.rightCaseId}, ${link.linkKind}, ${link.linkStrength},
        ${link.supporting.join(", ")}, ${link.contradicting.join(", ")}, ${link.sourceCount}, ${link.independentSourceCount}, ${link.note.slice(0, 500)}
      )
    `;
    saved += 1;
  }
  return { saved, note: saved ? `${saved} dokumentierte Verknüpfungen gespeichert.` : "Schon gespeichert. Keine neue Verknüpfung." };
}

function forbiddenLink(note: string) {
  return /wahrscheinliche[rsnm]?\s+t[aä]ter|gleicher\s+t[aä]ter/i.test(note);
}

async function storageReport() {
  const override = process.env.LIORA_DATA_DIR;
  if (dbSource === "neon") {
    return persistencePlan({ databaseUrl: "set", cwd: process.cwd(), directoryExists: true });
  }
  const pg = await getPglite();
  const liveDir = pg.dataDir ?? "";
  const backupDir = path.join(process.cwd(), ".data", "backups");
  const plan = persistencePlan({
    cwd: process.cwd(),
    override,
    directoryExists: Boolean(liveDir) && fs.existsSync(liveDir),
    backupExists: fs.existsSync(backupDir),
  });
  return {
    mode: plan.mode,
    locationLabel: plan.locationLabel,
    persistence: plan.persistence,
    backup: plan.backup,
    backupNote: liveDir ? plan.backupNote : "Der laufende Prozess hat noch keine Datei-Datenbank geöffnet. Dauerhaft erst nach dem nächsten Prozessstart. Ein Produktions-Backup ist nicht eingerichtet.",
  };
}
