import { getSql } from "@/lib/db";
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
import type { MemoryCategory } from "@/lib/domain";
import { writeAudit } from "@/lib/security/log";

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

export async function rememberContext(userId: string, utterance: string) {
  if (!userId || !utterance.trim() || findSecret(utterance)) return;
  const current = await loadContext(userId);
  const next = applyUtterance(current, utterance);
  await saveContext(userId, next.state);
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
  const analyzed = new Set(features.map((row) => row.case_id).filter(Boolean));
  const token = text.toLowerCase();
  const present = new Set(
    features
      .filter((row) => row.feature_value && token.includes(String(row.feature_value).toLowerCase().slice(0, 80)))
      .map((row) => row.case_id),
  );
  const result = orchestrate({
    actorId: userId,
    ownerId: userId,
    text,
    context,
    memories,
    knowledge,
    sources,
    featurePresence: { analyzed: analyzed.size, present: present.size },
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
  return { taskId, memoryId, ...result };
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
  if (decision.action === "keep") return { ok: true as const, note: "Merkmale unverändert. Keine neue Bewertung.", version: decision.version };
  if (prior[0]) {
    await db`
      update ci_finding_versions set status = 'older'
      where user_id = ${userId} and finding_id = ${input.findingId} and status = 'current'
    `;
  }
  await db`
    insert into ci_finding_versions (id, user_id, finding_id, version, previous_value, new_value, reason, source_note, status)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.findingId}, ${decision.version}, ${decision.previousValue},
      ${decision.newValue}, ${decision.reason}, ${decision.source || "SOURCE MISSING"}, 'current'
    )
  `;
  return { ok: true as const, note: "Neue Version gespeichert. Die vorherige bleibt erhalten.", version: decision.version };
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
    db<{ finding_id: string; version: number; previous_value: string; new_value: string; reason: string; source_note: string; status: string; created_at: unknown }>`
      select finding_id, version, previous_value, new_value, reason, source_note, status, created_at
      from ci_finding_versions where user_id = ${userId}
      order by created_at desc limit 8
    `,
    listCoreGraph(userId),
  ]);
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
    })),
    graph,
    notConfigured: ["Vektorsuche ist nicht eingerichtet.", "Diese Ansicht startet keine Websuche.", "Produktionscode wird nicht selbst geändert."],
  };
}
