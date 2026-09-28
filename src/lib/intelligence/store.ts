import { getSql, type Sql } from "@/lib/db";
import { readProfile, saveMemory } from "@/lib/data.server";
import {
  benchmarkCatalog,
  buildPipeline,
  classifySource,
  detectGap,
  evaluateAnswer,
  findConflicts,
  findDuplicate,
  findSecret,
  jaccard,
  median,
  parseFeedback,
  routeTask,
  runBenchmarks,
  type ExistingFact,
} from "@/lib/intelligence/engine";
import { rememberContext } from "@/lib/intelligence/core-store";
import type {
  ClaimDTO,
  CycleDTO,
  CycleReport,
  ErrorDTO,
  EvalFlag,
  GapDTO,
  KnowledgeDTO,
  KnowledgeStatus,
  PipelineStep,
  ProposalDTO,
  RunDTO,
  SourceDTO,
  SystemBoard,
  VersionDTO,
} from "@/lib/intelligence/types";

const KINDS = [
  ["knowledge", "Wissen"],
  ["memory", "Erinnerung"],
  ["prompt", "Prompt"],
  ["agent", "Agenten"],
  ["app", "App"],
] as const;

const STATUSES: KnowledgeStatus[] = ["unverified", "current", "stale", "conflicted", "superseded", "rejected"];

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(String(value)).toISOString();
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asSteps(value: unknown): PipelineStep[] {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const step = item as PipelineStep;
    if (step.outcome !== "pass" && step.outcome !== "fail" && step.outcome !== "stop") return [];
    return [{ name: String(step.name ?? ""), outcome: step.outcome, note: String(step.note ?? "") }];
  });
}

function asFlags(value: unknown): EvalFlag[] {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const flag = item as EvalFlag;
    if (!flag.code || !flag.detail) return [];
    return [{ code: String(flag.code), detail: String(flag.detail) }];
  });
}

function asFailures(value: unknown): { id: string; detail: string }[] {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: string; detail?: string };
    if (!row.id) return [];
    return [{ id: String(row.id), detail: String(row.detail ?? "") }];
  });
}

function asReport(value: unknown): CycleReport | null {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const report = raw as CycleReport;
  if (report.measured !== true || typeof report.from !== "string") return null;
  return report;
}

async function db(): Promise<Sql> {
  return getSql();
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function ensureIntelligence(userId: string) {
  const sql = await db();
  const rows = await sql<{ kind: string }>`select kind from ci_versions where user_id = ${userId} and active = true`;
  const have = new Set(rows.map((row) => row.kind));
  for (const [kind, label] of KINDS) {
    if (have.has(kind)) continue;
    await sql`
      insert into ci_versions (id, user_id, kind, version, label, note, active)
      values (${crypto.randomUUID()}, ${userId}, ${kind}, 1, ${`${label} v1`}, ${"Ausgang. Noch keine gemessene Verbesserung."}, true)
    `;
  }
}

async function facts(userId: string): Promise<ExistingFact[]> {
  const sql = await db();
  const rows = await sql<{ id: string; statement: string; status: string }>`
    select id, statement, status from ci_knowledge where user_id = ${userId} order by updated_at desc limit 400
  `;
  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    status: (STATUSES.includes(row.status as KnowledgeStatus) ? row.status : "unverified") as KnowledgeStatus,
  }));
}

export type StoredStatement = {
  status: KnowledgeStatus;
  steps: PipelineStep[];
  knowledgeId: string | null;
  note: string;
};

export async function processStatement(
  userId: string,
  input: { body: string; url?: string; title?: string; origin: string; verified?: boolean },
): Promise<StoredStatement> {
  await ensureIntelligence(userId);
  const body = input.body.trim().slice(0, 4000);
  const url = (input.url ?? "").trim().slice(0, 500);
  const title = (input.title ?? "").trim().slice(0, 180);
  if (findSecret(body) || findSecret(url) || findSecret(title)) {
    return {
      status: "rejected",
      knowledgeId: null,
      note: "Mögliches Geheimnis erkannt. Der Text wurde nicht gespeichert.",
      steps: [{ name: "Sicherheitsprüfung", outcome: "fail", note: "Schlüssel oder Token im Text. Nicht übernommen." }],
    };
  }
  const existing = await facts(userId);
  const duplicate = findDuplicate(body, existing);
  const conflicts = findConflicts(body, existing);
  const decision = buildPipeline({ text: body, url, duplicate, conflicts });
  if (!decision.store) {
    return {
      status: decision.status,
      steps: decision.steps,
      knowledgeId: duplicate?.id ?? null,
      note: "Schon vorhanden. Kein zweiter Eintrag.",
    };
  }
  const sql = await db();
  let sourceId: string | null = null;
  if (url || title) {
    const source = classifySource(url);
    sourceId = crypto.randomUUID();
    await sql`
      insert into ci_sources (id, user_id, url, title, kind, reliability, note)
      values (${sourceId}, ${userId}, ${url}, ${title || url || "Angabe"}, ${source.kind}, ${source.reliability}, ${source.note})
    `;
  }
  let status = decision.status;
  const verified = Boolean(input.verified) && status === "unverified";
  if (verified) {
    status = "current";
    const freshnessStep = decision.steps.find((step) => step.name === "Aktualität");
    if (freshnessStep) freshnessStep.note = "Du hast die Prüfung bestätigt. Der Status ist aktuell.";
  }
  const id = crypto.randomUUID();
  await sql`
    insert into ci_knowledge (
      id, user_id, topic, statement, normalized, status, source_id, last_verified_at, origin, pipeline
    ) values (
      ${id},
      ${userId},
      ${title || body.slice(0, 80)},
      ${body},
      ${body.toLowerCase().slice(0, 500)},
      ${status},
      ${sourceId},
      ${verified ? new Date().toISOString() : null},
      ${input.origin.slice(0, 32)},
      ${JSON.stringify(decision.steps)}::jsonb
    )
  `;
  for (const conflict of conflicts) {
    await sql`
      update ci_knowledge set status = 'conflicted', updated_at = now()
      where id = ${conflict.id} and user_id = ${userId} and status not in ('superseded', 'rejected')
    `;
  }
  return {
    status,
    steps: decision.steps,
    knowledgeId: id,
    note:
      status === "rejected"
        ? "Abgelehnt."
        : status === "conflicted"
          ? "Gespeichert und als Widerspruch markiert."
          : verified
            ? "Als von dir geprüft gespeichert."
            : "Gespeichert, aber ungeprüft. Gilt nicht als aktueller Fakt.",
  };
}

export async function queueIntake(userId: string, body: string, url: string, title: string) {
  await ensureIntelligence(userId);
  const text = body.trim().slice(0, 4000);
  if (text.length < 12) throw new Error("Zu kurz für die Warteschlange.");
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`
    insert into ci_intake (id, user_id, body, url, title, status)
    values (${id}, ${userId}, ${text}, ${url.trim().slice(0, 500)}, ${title.trim().slice(0, 180)}, 'pending')
  `;
  return id;
}

export async function submitIntake(userId: string, body: string, url: string, title: string, verified: boolean) {
  const result = await processStatement(userId, { body, url, title, origin: "intake", verified });
  const sql = await db();
  const status = result.note.startsWith("Schon") ? "duplicate" : result.status;
  await sql`
    insert into ci_intake (id, user_id, body, url, title, status, result_note)
    values (
      ${crypto.randomUUID()},
      ${userId},
      ${body.trim().slice(0, 4000)},
      ${url.trim().slice(0, 500)},
      ${title.trim().slice(0, 180)},
      ${status},
      ${result.note}
    )
  `;
  return result;
}

async function countWhere(sql: Sql, text: string, params: unknown[]): Promise<number> {
  const rows = await sql.query<{ n: number }>(text, params);
  return num(rows[0]?.n);
}

export async function runDailyCycle(userId: string): Promise<CycleReport> {
  await ensureIntelligence(userId);
  const sql = await db();
  const started = Date.now();
  const cycleId = crypto.randomUUID();
  await sql`
    insert into ci_cycles (id, user_id, status, report) values (${cycleId}, ${userId}, 'running', '{}'::jsonb)
  `;
  const parent = crypto.randomUUID();
  await sql`
    insert into ci_runs (id, user_id, agent, mode, tier, status, summary)
    values (${parent}, ${userId}, 'orchestrator', 'deep', 'normal', 'running', 'Tageszyklus')
  `;
  try {
    const waiting = await countWhere(sql, "select count(*) as n from ci_intake where user_id = $1 and status = 'pending'", [userId]);
    const pending = await sql<{ id: string; body: string; url: string; title: string }>`
      select id, body, url, title from ci_intake
      where user_id = ${userId} and status = 'pending'
      order by created_at asc limit 20
    `;
    let processed = 0;
    for (const item of pending) {
      const result = await processStatement(userId, {
        body: item.body,
        url: item.url,
        title: item.title,
        origin: "intake",
      });
      const status = result.note.startsWith("Schon") ? "duplicate" : result.status;
      await sql`update ci_intake set status = ${status}, result_note = ${result.note} where id = ${item.id} and user_id = ${userId}`;
      processed += 1;
    }
    const staleRows = await sql<{ id: string }>`
      update ci_knowledge set status = 'stale', updated_at = now()
      where user_id = ${userId} and status = 'current' and last_verified_at is not null
        and last_verified_at < now() - interval '30 days'
      returning id
    `;
    const benchStarted = Date.now();
    const bench = runBenchmarks();
    const failures = bench.filter((item) => !item.pass).map((item) => ({ id: item.id, detail: item.detail }));
    const passed = bench.length - failures.length;
    await sql`
      insert into ci_bench_runs (id, user_id, passed, failed, latency_ms, failures)
      values (${crypto.randomUUID()}, ${userId}, ${passed}, ${failures.length}, ${Date.now() - benchStarted}, ${JSON.stringify(failures)}::jsonb)
    `;
    const previous = await sql<{ failed: number; passed: number }>`
      select failed, passed from ci_bench_runs where user_id = ${userId} order by created_at desc offset 1 limit 1
    `;
    const benchRegressed = previous[0] ? failures.length > num(previous[0].failed) || passed < num(previous[0].passed) : null;
    if (benchRegressed) {
      await addProposal(userId, {
        agent: "orchestrator",
        kind: "rollback",
        title: "Testlauf schlechter als der vorherige",
        body: `Bestanden ${passed}, nicht bestanden ${failures.length}. Der vorherige Lauf war besser. Produktionscode wurde nicht zurückgesetzt.`,
        risk: "gated",
      });
    }
    const cycleRow = await sql<{ started_at: unknown }>`select started_at from ci_cycles where id = ${cycleId} and user_id = ${userId}`;
    const from = iso(cycleRow[0]?.started_at ?? new Date().toISOString());
    const windowParams = [userId, from];
    const report: CycleReport = {
      measured: true,
      from,
      to: new Date().toISOString(),
      intakeWaiting: waiting,
      intakeProcessed: processed,
      sourcesAdded: await countWhere(sql, "select count(*) as n from ci_sources where user_id = $1 and created_at >= $2", windowParams),
      knowledgeCreated: await countWhere(sql, "select count(*) as n from ci_knowledge where user_id = $1 and created_at >= $2", windowParams),
      rowsTouched: await countWhere(sql, "select count(*) as n from ci_knowledge where user_id = $1 and updated_at >= $2", windowParams),
      contradictions: await countWhere(
        sql,
        "select count(*) as n from ci_knowledge where user_id = $1 and status = 'conflicted' and updated_at >= $2",
        windowParams,
      ),
      errorsFound: await countWhere(sql, "select count(*) as n from ci_errors where user_id = $1 and created_at >= $2", windowParams),
      errorsCorrected: await countWhere(
        sql,
        "select count(*) as n from ci_errors where user_id = $1 and corrected_at is not null and corrected_at >= $2",
        windowParams,
      ),
      gapsOpened: await countWhere(sql, "select count(*) as n from ci_gaps where user_id = $1 and created_at >= $2", windowParams),
      gapsClosed: await countWhere(
        sql,
        "select count(*) as n from ci_gaps where user_id = $1 and status = 'closed' and updated_at >= $2",
        windowParams,
      ),
      staleMarked: staleRows.length,
      weakUnverified: await countWhere(
        sql,
        "select count(*) as n from ci_knowledge where user_id = $1 and status = 'unverified' and created_at < now() - interval '7 days'",
        [userId],
      ),
      benchPassed: passed,
      benchFailed: failures.length,
      benchRegressed,
      proposalsOpened: await countWhere(sql, "select count(*) as n from ci_proposals where user_id = $1 and created_at >= $2", windowParams),
      selfCheckFlags: await countWhere(sql, "select count(*) as n from ci_evals where user_id = $1 and created_at >= $2", windowParams),
    };
    await sql`
      update ci_cycles set status = 'complete', report = ${JSON.stringify(report)}::jsonb, finished_at = now()
      where id = ${cycleId} and user_id = ${userId}
    `;
    await sql`
      update ci_runs set status = 'done', summary = ${"Tageszyklus gemessen"}, detail = ${JSON.stringify(report)}::jsonb,
        duration_ms = ${Date.now() - started}, finished_at = now()
      where id = ${parent} and user_id = ${userId}
    `;
    await sql`
      insert into ci_perf (id, user_id, kind, latency_ms, ok) values (${crypto.randomUUID()}, ${userId}, 'cycle', ${Date.now() - started}, true)
    `;
    return report;
  } catch (error) {
    await sql`update ci_cycles set status = 'failed', finished_at = now() where id = ${cycleId} and user_id = ${userId}`;
    await sql`
      update ci_runs set status = 'failed', summary = ${error instanceof Error ? error.message : "Zyklus fehlgeschlagen"}, finished_at = now()
      where id = ${parent} and user_id = ${userId}
    `;
    throw error;
  }
}

export async function listKnowledge(userId: string): Promise<KnowledgeDTO[]> {
  await ensureIntelligence(userId);
  const sql = await db();
  const rows = await sql<{
    id: string;
    topic: string;
    statement: string;
    status: string;
    origin: string;
    source_title: string | null;
    source_url: string | null;
    last_verified_at: unknown;
    updated_at: unknown;
    pipeline: unknown;
  }>`
    select k.id, k.topic, k.statement, k.status, k.origin, k.last_verified_at, k.updated_at, k.pipeline,
           s.title as source_title, s.url as source_url
    from ci_knowledge k
    left join ci_sources s on s.id = k.source_id
    where k.user_id = ${userId}
    order by k.updated_at desc
    limit 80
  `;
  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    statement: row.statement,
    status: (STATUSES.includes(row.status as KnowledgeStatus) ? row.status : "unverified") as KnowledgeStatus,
    origin: row.origin,
    sourceLabel: row.source_title || row.source_url || "",
    lastVerifiedAt: row.last_verified_at ? iso(row.last_verified_at) : null,
    updatedAt: iso(row.updated_at),
    steps: asSteps(row.pipeline),
  }));
}

export async function acceptKnowledge(userId: string, id: string) {
  const sql = await db();
  const rows = await sql<{ id: string; statement: string; status: string }>`
    select id, statement, status from ci_knowledge where id = ${id} and user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Eintrag nicht gefunden.");
  if (row.status === "rejected") throw new Error("Abgelehnte Einträge werden nicht zu Fakten.");
  const others = (await facts(userId)).filter((item) => item.id !== row.id);
  for (const conflict of findConflicts(row.statement, others)) {
    await sql`
      update ci_knowledge set status = 'superseded', supersedes_id = ${row.id}, updated_at = now()
      where id = ${conflict.id} and user_id = ${userId}
    `;
  }
  await sql`
    update ci_knowledge set status = 'current', last_verified_at = now(), updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

export async function archiveKnowledge(userId: string, id: string) {
  const sql = await db();
  await sql`
    update ci_knowledge set status = 'superseded', updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

export async function listErrors(userId: string): Promise<ErrorDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    original_answer: string;
    error_text: string;
    correction: string;
    source_note: string;
    cause: string;
    lesson: string;
    created_at: unknown;
    corrected_at: unknown;
  }>`
    select id, original_answer, error_text, correction, source_note, cause, lesson, created_at, corrected_at
    from ci_errors where user_id = ${userId} order by created_at desc limit 50
  `;
  return rows.map((row) => ({
    id: row.id,
    originalAnswer: row.original_answer,
    errorText: row.error_text,
    correction: row.correction,
    sourceNote: row.source_note,
    cause: row.cause,
    lesson: row.lesson,
    createdAt: iso(row.created_at),
    correctedAt: row.corrected_at ? iso(row.corrected_at) : null,
  }));
}

export async function correctError(userId: string, id: string, correction: string, sourceNote: string) {
  const text = correction.trim().slice(0, 2000);
  if (text.length < 8) throw new Error("Die Korrektur braucht einen Satz.");
  const sql = await db();
  const rows = await sql`
    update ci_errors set correction = ${text}, source_note = ${sourceNote.trim().slice(0, 500)}, corrected_at = now()
    where id = ${id} and user_id = ${userId} returning id
  `;
  if (!rows.length) throw new Error("Fehler nicht gefunden.");
  await processStatement(userId, { body: text, url: "", title: sourceNote, origin: "feedback" });
}

export async function listGaps(userId: string): Promise<GapDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    question: string;
    missing: string;
    status: string;
    resolution: string;
    updated_at: unknown;
  }>`select id, question, missing, status, resolution, updated_at from ci_gaps where user_id = ${userId} order by updated_at desc limit 40`;
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    missing: row.missing,
    status: row.status,
    resolution: row.resolution,
    updatedAt: iso(row.updated_at),
  }));
}

export async function closeGap(userId: string, id: string, resolution: string) {
  const text = resolution.trim().slice(0, 1000);
  if (text.length < 8) throw new Error("Schreib kurz, womit die Lücke geschlossen ist.");
  const sql = await db();
  await sql`
    update ci_gaps set status = 'closed', resolution = ${text}, updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

export async function listRuns(userId: string): Promise<RunDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    agent: string;
    parent_id: string | null;
    mode: string;
    tier: string;
    status: string;
    summary: string;
    duration_ms: number | null;
    started_at: unknown;
  }>`
    select id, agent, parent_id, mode, tier, status, summary, duration_ms, started_at
    from ci_runs where user_id = ${userId} order by started_at desc limit 40
  `;
  return rows.map((row) => ({
    id: row.id,
    agent: row.agent,
    parentId: row.parent_id,
    mode: row.mode,
    tier: row.tier,
    status: row.status,
    summary: row.summary,
    durationMs: row.duration_ms == null ? null : num(row.duration_ms),
    startedAt: iso(row.started_at),
  }));
}

export async function listProposals(userId: string): Promise<ProposalDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    agent: string;
    kind: string;
    title: string;
    body: string;
    risk: string;
    status: string;
    effect: string;
    created_at: unknown;
  }>`
    select id, agent, kind, title, body, risk, status, effect, created_at
    from ci_proposals where user_id = ${userId} order by created_at desc limit 40
  `;
  return rows.map((row) => ({
    id: row.id,
    agent: row.agent,
    kind: row.kind,
    title: row.title,
    body: row.body,
    risk: row.risk,
    status: row.status,
    effect: row.effect,
    createdAt: iso(row.created_at),
  }));
}

export async function addProposal(
  userId: string,
  input: { agent: string; kind: string; title: string; body: string; risk: string; snapshotId?: string | null },
) {
  await ensureIntelligence(userId);
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`
    insert into ci_proposals (id, user_id, agent, kind, title, body, risk, snapshot_id)
    values (
      ${id}, ${userId}, ${input.agent}, ${input.kind}, ${input.title.slice(0, 180)}, ${input.body.slice(0, 4000)},
      ${input.risk}, ${input.snapshotId ?? null}
    )
  `;
  return id;
}

export async function decideProposal(userId: string, id: string, approve: boolean) {
  const sql = await db();
  const rows = await sql<{ id: string; kind: string; status: string; snapshot_id: string | null }>`
    select id, kind, status, snapshot_id from ci_proposals where id = ${id} and user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Vorschlag nicht gefunden.");
  if (row.status !== "pending") throw new Error("Dieser Vorschlag ist schon entschieden.");
  let effect = "Abgelehnt. Es wurde nichts geändert.";
  if (approve && row.kind === "knowledge_rollback" && row.snapshot_id) {
    const restored = await restoreSnapshot(userId, row.snapshot_id);
    effect = `Wissensstatus von ${restored} Einträgen zurückgesetzt. Neuere Einträge, Erinnerungen, Schlüssel und Code blieben unverändert.`;
  } else if (approve) {
    effect = "Freigabe gespeichert. Produktion, Schlüssel, Rechte, Kostenlimits und Erinnerungen wurden nicht verändert.";
  }
  await sql`
    update ci_proposals set status = ${approve ? "approved" : "rejected"}, effect = ${effect}, decided_at = now()
    where id = ${id} and user_id = ${userId}
  `;
  return effect;
}

async function restoreSnapshot(userId: string, snapshotId: string) {
  const sql = await db();
  const rows = await sql<{ payload: unknown }>`
    select payload from ci_snapshots where id = ${snapshotId} and user_id = ${userId} limit 1
  `;
  const payload = rows[0]?.payload;
  const parsed = typeof payload === "string" ? safeParse(payload) : payload;
  const items =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: { id?: string; status?: string; lastVerifiedAt?: string | null }[] }).items
      : [];
  let n = 0;
  for (const item of items) {
    if (!item.id || !item.status) continue;
    const updated = await sql`
      update ci_knowledge set status = ${item.status}, last_verified_at = ${item.lastVerifiedAt ?? null}, updated_at = now()
      where id = ${item.id} and user_id = ${userId} returning id
    `;
    n += updated.length;
  }
  return n;
}

export async function saveSnapshot(userId: string) {
  await ensureIntelligence(userId);
  const sql = await db();
  const current = await sql<{ version: number }>`
    select version from ci_versions where user_id = ${userId} and kind = 'knowledge' and active = true order by version desc limit 1
  `;
  const next = num(current[0]?.version) + 1;
  const items = await sql<{ id: string; status: string; last_verified_at: unknown }>`
    select id, status, last_verified_at from ci_knowledge where user_id = ${userId}
  `;
  const snapshotId = crypto.randomUUID();
  await sql`update ci_versions set active = false where user_id = ${userId} and kind = 'knowledge'`;
  await sql`
    insert into ci_versions (id, user_id, kind, version, label, note, active)
    values (${crypto.randomUUID()}, ${userId}, 'knowledge', ${next}, ${`Wissen v${next}`}, ${"Stand gesichert."}, true)
  `;
  await sql`
    insert into ci_snapshots (id, user_id, kind, version, payload)
    values (
      ${snapshotId},
      ${userId},
      'knowledge',
      ${next},
      ${JSON.stringify({
        items: items.map((item) => ({
          id: item.id,
          status: item.status,
          lastVerifiedAt: item.last_verified_at ? iso(item.last_verified_at) : null,
        })),
      })}::jsonb
    )
  `;
  return { version: next, snapshotId, count: items.length };
}

export async function proposeRollback(userId: string) {
  const sql = await db();
  const rows = await sql<{ id: string; version: number }>`
    select id, version from ci_snapshots where user_id = ${userId} and kind = 'knowledge' order by created_at desc limit 2
  `;
  const target = rows[1];
  if (!target) throw new Error("Es gibt noch keinen früheren Wissensstand.");
  return addProposal(userId, {
    agent: "memory",
    kind: "knowledge_rollback",
    title: `Wissen auf Version ${target.version} zurücksetzen`,
    body: "Setzt nur den Status gespeicherter Aussagen zurück. Erinnerungen, Code, Schlüssel und Rechte bleiben.",
    risk: "gated",
    snapshotId: target.id,
  });
}

export async function listClaims(userId: string): Promise<ClaimDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    claim: string;
    status: string;
    primary_note: string;
    secondary_note: string;
    conflict_note: string;
    created_at: unknown;
  }>`
    select id, claim, status, primary_note, secondary_note, conflict_note, created_at
    from ci_claims where user_id = ${userId} order by created_at desc limit 20
  `;
  return rows.map((row) => ({
    id: row.id,
    claim: row.claim,
    status: row.status,
    primaryNote: row.primary_note,
    secondaryNote: row.secondary_note,
    conflictNote: row.conflict_note,
    createdAt: iso(row.created_at),
  }));
}

export async function openRun(userId: string, input: { agent: string; parentId?: string | null; mode: string; tier: string; summary: string }) {
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`
    insert into ci_runs (id, user_id, agent, parent_id, mode, tier, status, summary)
    values (${id}, ${userId}, ${input.agent}, ${input.parentId ?? null}, ${input.mode}, ${input.tier}, 'running', ${input.summary.slice(0, 240)})
  `;
  return id;
}

export async function closeRun(userId: string, id: string, input: { status: string; summary: string; detail?: unknown; started: number }) {
  const sql = await db();
  await sql`
    update ci_runs set status = ${input.status}, summary = ${input.summary.slice(0, 500)},
      detail = ${JSON.stringify(input.detail ?? {})}::jsonb, duration_ms = ${Date.now() - input.started}, finished_at = now()
    where id = ${id} and user_id = ${userId}
  `;
  await sql`
    insert into ci_perf (id, user_id, kind, latency_ms, ok)
    values (${crypto.randomUUID()}, ${userId}, 'agent', ${Date.now() - input.started}, ${input.status === "done"})
  `;
}

export async function recordPerf(userId: string, kind: string, latencyMs: number, ok: boolean) {
  const sql = await db();
  await sql`
    insert into ci_perf (id, user_id, kind, latency_ms, ok)
    values (${crypto.randomUUID()}, ${userId}, ${kind}, ${Math.max(0, Math.round(latencyMs))}, ${ok})
  `;
}

export async function loadPromptContext(userId: string): Promise<{ rules: string[]; facts: string[]; withheld: number }> {
  const sql = await db();
  const rules = await sql<{ rule: string }>`
    select rule from ci_rules where user_id = ${userId} and active = true order by created_at desc limit 8
  `;
  const current = await sql<{ statement: string }>`
    select statement from ci_knowledge
    where user_id = ${userId} and status = 'current' and last_verified_at is not null
      and last_verified_at > now() - interval '30 days'
    order by last_verified_at desc limit 8
  `;
  const withheld = await countWhere(
    sql,
    "select count(*) as n from ci_knowledge where user_id = $1 and status in ('unverified', 'stale', 'conflicted', 'superseded')",
    [userId],
  );
  return {
    rules: rules.map((row) => row.rule.slice(0, 300)),
    facts: current.map((row) => row.statement.slice(0, 300)),
    withheld,
  };
}

export async function onUserMessage(userId: string, text: string, priorAnswer: string): Promise<string | null> {
  await rememberContext(userId, text).catch(() => undefined);
  const hit = parseFeedback(text);
  if (!hit) {
    const decision = routeTask(text);
    if (decision.mode !== "deep") return null;
    const known = (await facts(userId)).filter((item) => item.status !== "rejected").map((item) => item.statement);
    const gap = detectGap(text, known);
    if (!gap.open) return null;
    const sql = await db();
    const open = await sql<{ question: string }>`
      select question from ci_gaps where user_id = ${userId} and status = 'open' order by created_at desc limit 20
    `;
    if (open.some((row) => row.question.slice(0, 180) === text.trim().slice(0, 180))) return null;
    await sql`
      insert into ci_gaps (id, user_id, question, missing, status)
      values (${crypto.randomUUID()}, ${userId}, ${text.trim().slice(0, 500)}, ${gap.missing}, 'open')
    `;
    return "Wissenslücke notiert. Es wurde nichts dazu geraten.";
  }
  if (hit.kind === "preference") {
    const sql = await db();
    const rules = await sql<{ rule: string }>`select rule from ci_rules where user_id = ${userId} and active = true limit 30`;
    if (rules.some((row) => row.rule === hit.rule)) return "Diese Regel ist schon gespeichert.";
    await sql`
      insert into ci_rules (id, user_id, rule, source_quote)
      values (${crypto.randomUUID()}, ${userId}, ${hit.rule}, ${text.trim().slice(0, 500)})
    `;
    await saveMemory(userId, { category: "preference", title: "Regel aus dem Chat", content: hit.rule }).catch(() => undefined);
    return "Als persönliche Regel gespeichert.";
  }
  const sql = await db();
  await sql`
    insert into ci_errors (id, user_id, original_answer, error_text, correction, cause, lesson, corrected_at)
    values (
      ${crypto.randomUUID()},
      ${userId},
      ${priorAnswer.slice(0, 4000)},
      ${text.trim().slice(0, 1000)},
      ${hit.correction},
      ${"Nutzerkorrektur"},
      ${"Diese Aussage nicht wiederholen, bevor eine Quelle oder die Korrektur geprüft ist."},
      ${hit.correction ? new Date().toISOString() : null}
    )
  `;
  await sql`
    insert into ci_claims (id, user_id, claim, status, conflict_note)
    values (${crypto.randomUUID()}, ${userId}, ${text.trim().slice(0, 500)}, 'insufficient', ${"Vom Chat ausgelöst. Noch keine Quelle."})
  `;
  if (hit.correction) await processStatement(userId, { body: hit.correction, origin: "feedback" });
  return hit.correction
    ? "Korrektur notiert und ungeprüft abgelegt. Sie gilt noch nicht als Fakt."
    : "Als Fehler notiert. Verifikation ist offen, nichts wurde überschrieben.";
}

export async function onAssistantAnswer(
  userId: string,
  input: { messageId: string; answer: string; userText: string; citations: { url?: string; snippet?: string }[]; mode: string },
) {
  const sql = await db();
  const conflicted = await sql<{ statement: string }>`
    select statement from ci_knowledge where user_id = ${userId} and status = 'conflicted' limit 30
  `;
  const flags = evaluateAnswer({
    answer: input.answer,
    userText: input.userText,
    citations: input.citations,
    mode: input.mode,
    conflicted: conflicted.map((row) => row.statement),
  });
  if (!flags.length) return;
  await sql`
    insert into ci_evals (id, user_id, message_id, flags)
    values (${crypto.randomUUID()}, ${userId}, ${input.messageId}, ${JSON.stringify(flags)}::jsonb)
  `;
}

export async function textsForScan(userId: string): Promise<string[]> {
  const sql = await db();
  const knowledge = await sql<{ statement: string }>`select statement from ci_knowledge where user_id = ${userId} order by updated_at desc limit 80`;
  const rules = await sql<{ rule: string }>`select rule from ci_rules where user_id = ${userId} limit 40`;
  return [...knowledge.map((row) => row.statement), ...rules.map((row) => row.rule)];
}

export async function perfSamples(userId: string): Promise<number[]> {
  const sql = await db();
  const rows = await sql<{ latency_ms: number }>`
    select latency_ms from ci_perf where user_id = ${userId} order by created_at desc limit 30
  `;
  return rows.map((row) => num(row.latency_ms));
}

export async function sourcesFor(userId: string, query: string) {
  const sql = await db();
  const rows = await sql<{ title: string; url: string; kind: string; note: string }>`
    select title, url, kind, note from ci_sources where user_id = ${userId} order by created_at desc limit 40
  `;
  return rows.filter((row) => jaccard(query, `${row.title} ${row.note}`) >= 0.12 || (row.url && query.includes(row.url)));
}

export async function listSources(userId: string): Promise<SourceDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    url: string;
    title: string;
    kind: string;
    reliability: string;
    note: string;
    published_at: string;
    checked_at: unknown;
    created_at: unknown;
  }>`
    select id, url, title, kind, reliability, note, published_at, checked_at, created_at
    from ci_sources where user_id = ${userId}
    order by created_at desc
    limit 80
  `;
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    kind: row.kind,
    reliability: row.reliability,
    note: row.note,
    publishedAt: row.published_at ?? "",
    checkedAt: row.checked_at ? iso(row.checked_at) : null,
    createdAt: iso(row.created_at),
  }));
}

export async function rememberSource(
  userId: string,
  input: { url: string; title: string; kind: string; reliability: string; note: string; checked: boolean },
) {
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`
    insert into ci_sources (id, user_id, url, title, kind, reliability, note, checked_at)
    values (
      ${id}, ${userId}, ${input.url.slice(0, 500)}, ${input.title.slice(0, 180)}, ${input.kind}, ${input.reliability},
      ${input.note.slice(0, 500)}, ${input.checked ? new Date().toISOString() : null}
    )
  `;
  return id;
}

export async function rememberClaim(
  userId: string,
  input: { claim: string; status: string; primaryNote: string; secondaryNote: string; conflictNote: string },
) {
  const sql = await db();
  await sql`
    insert into ci_claims (id, user_id, claim, status, primary_note, secondary_note, conflict_note)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.claim.slice(0, 500)}, ${input.status},
      ${input.primaryNote.slice(0, 500)}, ${input.secondaryNote.slice(0, 500)}, ${input.conflictNote.slice(0, 500)}
    )
  `;
}

export async function upsertModels(userId: string, ids: string[]) {
  const sql = await db();
  const existing = await sql<{ model_id: string }>`select model_id from ci_models where user_id = ${userId}`;
  const known = new Set(existing.map((row) => row.model_id));
  const added: string[] = [];
  for (const modelId of ids) {
    if (known.has(modelId)) {
      await sql`update ci_models set last_seen_at = now() where user_id = ${userId} and model_id = ${modelId}`;
    } else {
      added.push(modelId);
      await sql`insert into ci_models (id, user_id, model_id) values (${crypto.randomUUID()}, ${userId}, ${modelId})`;
    }
  }
  return added;
}

export async function listModelIds(userId: string): Promise<string[]> {
  const sql = await db();
  const rows = await sql<{ model_id: string }>`select model_id from ci_models where user_id = ${userId} order by model_id`;
  return rows.map((row) => row.model_id);
}

export async function saveProbe(userId: string, input: { modelId: string; expected: string; output: string; passed: boolean; latencyMs: number }) {
  const sql = await db();
  await sql`
    insert into ci_probes (id, user_id, model_id, expected, output, passed, latency_ms)
    values (${crypto.randomUUID()}, ${userId}, ${input.modelId}, ${input.expected}, ${input.output.slice(0, 400)}, ${input.passed}, ${input.latencyMs})
  `;
}

export async function latestProbe(userId: string, modelId: string) {
  const sql = await db();
  const rows = await sql<{ passed: boolean; latency_ms: number; output: string; created_at: unknown }>`
    select passed, latency_ms, output, created_at from ci_probes
    where user_id = ${userId} and model_id = ${modelId}
    order by created_at desc limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { passed: Boolean(row.passed), latencyMs: num(row.latency_ms), output: row.output, createdAt: iso(row.created_at) };
}

export async function listVersions(userId: string): Promise<VersionDTO[]> {
  await ensureIntelligence(userId);
  const sql = await db();
  const rows = await sql<{ kind: string; version: number; label: string; note: string; created_at: unknown }>`
    select kind, version, label, note, created_at from ci_versions
    where user_id = ${userId} and active = true order by kind
  `;
  return rows.map((row) => ({
    kind: row.kind,
    version: num(row.version),
    label: row.label,
    note: row.note,
    createdAt: iso(row.created_at),
  }));
}

function mapCycle(row: { id: string; status: string; report: unknown; started_at: unknown; finished_at: unknown }): CycleDTO {
  return {
    id: row.id,
    status: row.status,
    startedAt: iso(row.started_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
    report: asReport(row.report),
  };
}

export async function loadBoard(userId: string): Promise<SystemBoard> {
  await ensureIntelligence(userId);
  const sql = await db();
  const profile = await readProfile(userId);
  const grouped = await sql<{ status: string; n: number }>`
    select status, count(*) as n from ci_knowledge where user_id = ${userId} group by status
  `;
  const knowledge = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<KnowledgeStatus, number>;
  for (const row of grouped) {
    if (STATUSES.includes(row.status as KnowledgeStatus)) knowledge[row.status as KnowledgeStatus] = num(row.n);
  }
  const usage = await sql<{ kind: string; n: number }>`
    select kind, count(*) as n from usage_events
    where user_id = ${userId} and created_at > now() - interval '2 days' group by kind
  `;
  const usageOf = (kind: string) => num(usage.find((row) => row.kind === kind)?.n);
  const samples = await perfSamples(userId);
  const mid = median(samples);
  const cycles = await sql<{ id: string; status: string; report: unknown; started_at: unknown; finished_at: unknown }>`
    select id, status, report, started_at, finished_at from ci_cycles where user_id = ${userId} order by started_at desc limit 8
  `;
  const bench = await sql<{ passed: number; failed: number; latency_ms: number; failures: unknown; created_at: unknown }>`
    select passed, failed, latency_ms, failures, created_at from ci_bench_runs where user_id = ${userId} order by created_at desc limit 1
  `;
  const flags = await sql<{ id: string; flags: unknown; created_at: unknown }>`
    select id, flags, created_at from ci_evals where user_id = ${userId} order by created_at desc limit 8
  `;
  const benchRow = bench[0];
  return {
    versions: await listVersions(userId),
    inventory: {
      knowledge,
      sources: await countWhere(sql, "select count(*) as n from ci_sources where user_id = $1", [userId]),
      sourcesChecked: await countWhere(sql, "select count(*) as n from ci_sources where user_id = $1 and checked_at is not null", [userId]),
      memories: await countWhere(sql, "select count(*) as n from memories where user_id = $1", [userId]),
      rules: await countWhere(sql, "select count(*) as n from ci_rules where user_id = $1 and active = true", [userId]),
      gapsOpen: await countWhere(sql, "select count(*) as n from ci_gaps where user_id = $1 and status = 'open'", [userId]),
      errors: await countWhere(sql, "select count(*) as n from ci_errors where user_id = $1", [userId]),
      errorsCorrected: await countWhere(sql, "select count(*) as n from ci_errors where user_id = $1 and corrected_at is not null", [userId]),
      proposalsPending: await countWhere(sql, "select count(*) as n from ci_proposals where user_id = $1 and status = 'pending'", [userId]),
      usageChat: usageOf("chat"),
      usageResearch: usageOf("research"),
    },
    latency: mid == null ? null : { n: samples.length, medianMs: mid },
    modelId: profile.modelId,
    latestCycle: cycles[0] ? mapCycle(cycles[0]) : null,
    cycles: cycles.map(mapCycle),
    bench: benchRow
      ? {
          passed: num(benchRow.passed),
          failed: num(benchRow.failed),
          latencyMs: num(benchRow.latency_ms),
          at: iso(benchRow.created_at),
          failures: asFailures(benchRow.failures),
        }
      : null,
    cases: benchmarkCatalog(),
    recentFlags: flags.map((row) => ({ id: row.id, flags: asFlags(row.flags), createdAt: iso(row.created_at) })),
  };
}
