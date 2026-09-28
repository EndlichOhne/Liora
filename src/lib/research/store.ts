import { getSql } from "@/lib/db";
import { runTask } from "@/lib/intelligence/agents";
import { classifySource, findSecret } from "@/lib/intelligence/engine";
import { compareStored, getCaseFile } from "@/lib/cases/store";
import { contentHash, safePublicUrl } from "@/lib/cases/engine";
import { rejectDiscoveryClaim } from "@/lib/cases/discovery";
import { normalizeName, personResearchRequest } from "@/lib/people/rules";
import { noteSourceMentions } from "@/lib/people/store";
import { loadContext, resolveOwnedCase } from "@/lib/intelligence/core-store";
import { redactError } from "@/lib/security/check";
import {
  buildPlan,
  scopeFor,
  familyKey,
  isDuplicateRequest,
  isFollowUp,
  markIndependence,
  nextStatus,
  normalizeRequest,
  openQuestions,
  priorityFor,
  reevaluateDecision,
  scanRequest,
  sessionFor,
  timelineFromEvents,
  titleFromRequest,
  type PriorTask,
  type ResearchStatus,
} from "@/lib/research/engine";

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return value ? new Date(String(value)).toISOString() : "";
}

async function sql() {
  return getSql();
}

type TaskRow = {
  id: string;
  session_id: string;
  case_id: string | null;
  title: string;
  original_request: string;
  normalized_request: string;
  status: string;
  priority: string;
  scope: string;
  started_at: unknown;
  finished_at: unknown;
  last_error: string | null;
  context_json: unknown;
  result_summary: string | null;
  created_at: unknown;
  updated_at: unknown;
};

function mapTask(row: TaskRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    caseId: row.case_id ?? "",
    title: row.title,
    originalRequest: row.original_request,
    normalizedRequest: row.normalized_request,
    status: row.status,
    priority: row.priority,
    scope: row.scope,
    startedAt: row.started_at ? iso(row.started_at) : "",
    finishedAt: row.finished_at ? iso(row.finished_at) : "",
    lastError: row.last_error ?? "",
    context: typeof row.context_json === "object" && row.context_json ? row.context_json : {},
    resultSummary: row.result_summary ?? "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const TASK_SELECT = `id, session_id, case_id, title, original_request, normalized_request, status, priority, scope,
  started_at, finished_at, last_error, context_json, result_summary, created_at, updated_at`;

async function priorTasks(userId: string): Promise<PriorTask[]> {
  const db = await sql();
  const rows = await db.query<TaskRow>(
    `select ${TASK_SELECT} from ci_research_tasks where user_id = $1 order by updated_at desc limit 40`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    caseId: row.case_id,
    normalized: row.normalized_request,
    status: row.status,
    updatedAt: iso(row.updated_at),
    scope: row.scope,
  }));
}

export async function listResearchTasks(userId: string) {
  const db = await sql();
  const rows = await db.query<TaskRow>(
    `select ${TASK_SELECT} from ci_research_tasks where user_id = $1 order by updated_at desc limit 40`,
    [userId],
  );
  return rows.map(mapTask);
}

async function readTask(userId: string, id: string) {
  const db = await sql();
  const rows = await db.query<TaskRow>(
    `select ${TASK_SELECT} from ci_research_tasks where user_id = $1 and id = $2 limit 1`,
    [userId, id],
  );
  return rows[0] ? mapTask(rows[0]) : null;
}

async function setStatus(userId: string, id: string, status: ResearchStatus, extra: { error?: string; summary?: string } = {}) {
  const db = await sql();
  const finished = status === "completed" || status === "failed";
  await db`
    update ci_research_tasks
    set status = ${status},
        updated_at = now(),
        finished_at = ${finished ? new Date().toISOString() : null},
        last_error = ${extra.error ? extra.error.slice(0, 500) : null},
        result_summary = coalesce(${extra.summary ? extra.summary.slice(0, 1000) : null}, result_summary)
    where user_id = ${userId} and id = ${id}
  `;
}

export async function loadResearchTask(userId: string, id: string) {
  const task = await readTask(userId, id);
  if (!task) return null;
  const db = await sql();
  const steps = await db<{ id: string; position: number; name: string; note: string; status: string }>`
    select id, position, name, note, status from ci_research_steps
    where user_id = ${userId} and task_id = ${id}
    order by position
  `;
  const elements = await db<{
    id: string;
    kind: string;
    raw_value: string;
    normalized_value: string;
    normalization_method: string;
    status: string;
    polarity: string;
    source_url: string;
    evidence_class: string;
    confidence: string;
  }>`
    select id, kind, raw_value, normalized_value, normalization_method, status, polarity, source_url, evidence_class, confidence
    from ci_research_elements
    where user_id = ${userId} and task_id = ${id}
    order by created_at
  `;
  const sources = await db<{
    id: string;
    url: string;
    title: string;
    kind: string;
    note: string;
    independence_status: string;
    source_family_id: string | null;
    parent_source_id: string | null;
  }>`
    select id, url, title, kind, note, independence_status, source_family_id, parent_source_id
    from ci_sources
    where user_id = ${userId} and task_id = ${id}
    order by created_at
  `;
  const questions = await db<{ id: string; question: string; priority: string; status: string; resolved_at: unknown }>`
    select id, question, priority, status, resolved_at
    from ci_gaps
    where user_id = ${userId} and task_id = ${id}
    order by created_at
  `;
  const file = task.caseId ? await getCaseFile(userId, task.caseId) : null;
  const timeline = file
    ? timelineFromEvents(
        task.caseId,
        file.events.map((event) => ({
          occurredOn: event.occurredOn,
          label: event.label,
          detail: event.detail,
          sourceUrl: event.sourceUrl,
          place: file.case.place || file.case.city,
        })),
      )
    : [];
  const contradictions = (file?.contradictions ?? []).map((item) => ({ left: item.left, right: item.right }));
  const history = await listResearchTasks(userId);
  const sameSession = history.filter((item) => item.sessionId === task.sessionId);
  return {
    task,
    steps: steps.map((step) => ({ id: step.id, position: Number(step.position), name: step.name, note: step.note, status: step.status })),
    elements: elements.map((item) => ({
      id: item.id,
      kind: item.kind,
      rawValue: item.raw_value,
      normalizedValue: item.normalized_value,
      normalizationMethod: item.normalization_method,
      status: item.status,
      polarity: item.polarity,
      sourceUrl: item.source_url,
      evidenceClass: item.evidence_class,
      confidence: item.confidence,
    })),
    sources: sources.map((source) => ({
      id: source.id,
      url: source.url,
      title: source.title,
      kind: source.kind,
      note: source.note,
      independenceStatus: source.independence_status || "unknown",
      sourceFamilyId: source.source_family_id ?? "",
      parentSourceId: source.parent_source_id ?? "",
    })),
    questions: questions.map((item) => ({
      id: item.id,
      question: item.question,
      priority: item.priority || "medium",
      status: item.status,
      resolvedAt: item.resolved_at ? iso(item.resolved_at) : "",
    })),
    session: sameSession.map((item) => ({ id: item.id, title: item.title, status: item.status, scope: item.scope, updatedAt: item.updatedAt })),
    timeline,
    contradictions,
    crossCase: { note: task.resultSummary, created: 0, decision: "" },
  };
}

async function annotateFamilies(userId: string) {
  const db = await sql();
  const rows = await db<{ id: string; url: string; title: string; note: string }>`
    select id, url, title, note from ci_sources where user_id = ${userId} order by created_at limit 80
  `;
  const marked = markIndependence(rows);
  for (const row of marked) {
    const hash = contentHash(`${row.url}|${row.title}|${row.note}`);
    await db`
      update ci_sources
      set independence_status = ${row.independenceStatus},
          source_family_id = ${row.sourceFamilyId},
          parent_source_id = ${row.parentSourceId || null},
          origin_source_id = ${row.parentSourceId || row.id},
          content_hash = ${hash},
          publisher = ${familyKey(row.url, row.title).slice(0, 120)}
      where id = ${row.id} and user_id = ${userId}
    `;
  }
}

async function syncQuestions(
  userId: string,
  taskId: string,
  caseId: string,
  asked: { vehicle: boolean; court: boolean; time: boolean },
) {
  const db = await sql();
  const events = caseId
    ? await db<{ occurred_on: string; label: string; detail: string; source_url: string }>`
        select occurred_on, label, detail, source_url from ci_case_events
        where user_id = ${userId} and case_id = ${caseId} and historical = false
        order by created_at limit 40
      `
    : [];
  const file = caseId ? await getCaseFile(userId, caseId) : null;
  const stored = events.map((event) => ({
    occurredOn: text(event.occurred_on),
    label: text(event.label),
    detail: text(event.detail),
    sourceUrl: text(event.source_url),
    place: file?.case.place || file?.case.city || "",
  }));
  const vehicleRows = caseId
    ? await db<{ id: string }>`
        select id from ci_research_elements
        where user_id = ${userId} and case_id = ${caseId} and kind = 'vehicle' and polarity = 'positive'
        limit 1
      `
    : await db<{ id: string }>`
        select id from ci_research_elements
        where user_id = ${userId} and kind = 'vehicle' and polarity = 'positive'
        limit 1
      `;
  const hasVehicle = Boolean(file?.items.some((item) => /fahrzeug|kennzeichen|mercedes/i.test(item.body)) || vehicleRows.length);
  const hasCourt = Boolean(file?.case.courtName || file?.items.some((item) => item.evidence === "court"));
  const questions = openQuestions({
    events: stored,
    hasCourtSource: hasCourt,
    hasVehicle,
    askedVehicle: asked.vehicle,
    askedCourt: asked.court,
    askedTime: asked.time,
  });
  const open = new Set(questions.map((item) => item.question));
  const existing = await db<{ id: string; question: string; status: string }>`
    select id, question, status from ci_gaps where user_id = ${userId} and task_id = ${taskId}
  `;
  for (const row of existing) {
    if (row.status === "open" && !open.has(row.question)) {
      await db`
        update ci_gaps
        set status = 'closed', resolution = 'Gespeicherte Angabe liegt jetzt vor.', resolved_at = now(), updated_at = now()
        where id = ${row.id} and user_id = ${userId}
      `;
    }
  }
  const known = new Set(existing.map((row) => row.question));
  for (const item of questions) {
    if (known.has(item.question)) continue;
    await db`
      insert into ci_gaps (id, user_id, question, missing, status, case_id, task_id, priority, source_ids)
      values (
        ${crypto.randomUUID()}, ${userId}, ${item.question}, ${item.question}, 'open',
        ${caseId || null}, ${taskId}, ${item.priority}, ''
      )
    `;
  }
  return questions;
}

export async function startResearchTask(
  userId: string,
  input: { request: string; web: boolean; caseId?: string },
) {
  const request = input.request.trim().slice(0, 2000);
  if (request.length < 8) throw new Error("Die Anfrage ist zu kurz.");
  if (rejectDiscoveryClaim(request) || findSecret(request)) throw new Error("Diese Anfrage wird nicht ausgeführt.");
  let caseId = (input.caseId ?? "").trim().slice(0, 80);
  if (!caseId && isFollowUp(request)) {
    const ctx = await loadContext(userId);
    const resolved = ctx.activeCase ? await resolveOwnedCase(userId, ctx.activeCase) : null;
    if (resolved) caseId = resolved;
  }
  if (caseId) {
    const file = await getCaseFile(userId, caseId);
    if (!file) throw new Error("Akte nicht gefunden.");
  }
  const normalized = normalizeRequest(request);
  const followUp = isFollowUp(request);
  const previous = await priorTasks(userId);
  if (isDuplicateRequest(previous, normalized, followUp)) {
    const existing = previous.find((row) => row.normalized === normalized);
    const task = existing ? await readTask(userId, existing.id) : null;
    return {
      task,
      duplicate: true as const,
      summary: "Dieselbe Anfrage liegt schon vor. Keine neue Bewertung.",
      decision: "NO NEW DATA" as const,
    };
  }
  const scope = scopeFor(request, followUp, followUp ? previous.find((row) => row.sessionId === sessionFor(previous, true, caseId || null))?.scope ?? null : null);
  const sessionId = sessionFor(previous, followUp, caseId || null) ?? crypto.randomUUID();
  const id = crypto.randomUUID();
  const db = await sql();
  const elements = scanRequest(request).filter((item) => item.status !== "fact");
  const context = {
    caseId,
    scope,
    followUp,
    terms: elements.map((item) => item.normalizedValue).slice(0, 20),
    web: input.web === true,
  };
  await db`
    insert into ci_research_tasks (
      id, user_id, session_id, case_id, title, original_request, normalized_request,
      status, priority, scope, started_at, context_json
    ) values (
      ${id}, ${userId}, ${sessionId}, ${caseId || null}, ${titleFromRequest(request)}, ${request}, ${normalized},
      ${nextStatus("queued", "start")}, ${priorityFor(request)}, ${scope}, now(), ${JSON.stringify(context)}::jsonb
    )
  `;
  const plan = buildPlan(request, scope, input.web === true, caseId || null);
  for (const [index, step] of plan.entries()) {
    await db`
      insert into ci_research_steps (id, user_id, task_id, position, name, note, status)
      values (${crypto.randomUUID()}, ${userId}, ${id}, ${index}, ${step.name}, ${step.note}, ${step.status})
    `;
  }
  for (const item of elements) {
    await db`
      insert into ci_research_elements (
        id, user_id, task_id, case_id, kind, raw_value, normalized_value, normalization_method,
        status, polarity, evidence_class, confidence
      ) values (
        ${crypto.randomUUID()}, ${userId}, ${id}, ${caseId || null}, ${item.kind}, ${item.rawValue},
        ${item.normalizedValue}, ${item.normalizationMethod}, ${item.status}, ${item.polarity}, 'unknown', 'unverified'
      )
    `;
  }
  let summary = "Nur die Anfrage und der gespeicherte Bestand. Nichts erfunden.";
  let personNote = "";
  const askedName = personResearchRequest(request);
  if (askedName) {
    const found = await db<{ display_name: string }>`
      select display_name from ci_persons
      where user_id = ${userId} and normalized_name = ${normalizeName(askedName)}
      limit 5
    `;
    personNote = found.length
      ? `Bestehende Person: ${found.map((row) => row.display_name).join(", ")}. Keine neue Person aus der Anfrage.`
      : "Keine gespeicherte Person zu diesem Namen. Aus der Anfrage wird keine Person angelegt.";
    await db`
      insert into ci_research_steps (id, user_id, task_id, position, name, note, status)
      values (${crypto.randomUUID()}, ${userId}, ${id}, ${plan.length}, 'Person', ${personNote}, 'done')
    `;
  }
  let decision: "NO NEW DATA" | "neu bewertet" = "neu bewertet";
  try {
    if (input.web === true) {
      const run = await runTask(userId, request, true);
      const urls = run.outputs.flatMap((item) => (Array.isArray(item.detail.citations) ? item.detail.citations : []));
      for (const url of urls) {
        if (typeof url !== "string" || !safePublicUrl(url)) continue;
        const source = classifySource(url);
        await db`
          update ci_sources
          set task_id = ${id}, case_id = ${caseId || null}
          where user_id = ${userId} and url = ${url.slice(0, 500)} and task_id is null
        `;
        void source;
      }
      const titled = await db<{ id: string; title: string; note: string }>`
        select id, title, note from ci_sources where user_id = ${userId} and task_id = ${id}
      `;
      for (const row of titled) await noteSourceMentions(userId, row.id, `${row.title} ${row.note}`);
      summary = run.outputs.map((item) => item.summary).join(" ").slice(0, 800) || summary;
    } else {
      summary = "Websuche nicht freigegeben. Nur gespeicherte Akte ausgewertet.";
    }
    await annotateFamilies(userId);
    const before = await db<{ fingerprint: string }>`select fingerprint from ci_discovery_state where user_id = ${userId} limit 1`;
    const compared = await compareStored(userId);
    const after = await db<{ fingerprint: string }>`select fingerprint from ci_discovery_state where user_id = ${userId} limit 1`;
    decision = reevaluateDecision(before[0]?.fingerprint ?? "", after[0]?.fingerprint ?? "");
    if (compared.unchanged || decision === "NO NEW DATA") {
      decision = "NO NEW DATA";
      summary = `${summary} NO NEW DATA. ${compared.note}`.slice(0, 1000);
    } else {
      summary = `${summary} ${compared.note}`.slice(0, 1000);
    }
    const asked = {
      vehicle: /fahrzeug|auto|kennzeichen|mercedes/i.test(request),
      court: /gericht|urteil/i.test(request),
      time: /uhrzeit|wann|uhr\b/i.test(request) || elements.some((item) => item.kind === "time"),
    };
    await syncQuestions(userId, id, caseId, asked);
    if (personNote) summary = `${summary} ${personNote}`.slice(0, 1000);
    await setStatus(userId, id, nextStatus("running", "finish"), { summary });
  } catch (error) {
    const message = redactError(error instanceof Error ? error.message : "Recherche fehlgeschlagen.");
    await setStatus(userId, id, nextStatus("running", "fail"), { error: message, summary: message });
    throw error;
  }
  return { task: await readTask(userId, id), duplicate: false as const, summary, decision };
}
