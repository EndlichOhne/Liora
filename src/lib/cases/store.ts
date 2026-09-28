import { getSql } from "@/lib/db";
import { jaccard } from "@/lib/intelligence/engine";
import {
  discover,
  extractCaseFeatures,
  featureFingerprint,
  featureNetwork,
  isFeatureKey,
  isOrigin,
  originMatchesEvidence,
  rejectDiscoveryClaim,
  type CaseSeed,
  type FeatureInput,
} from "@/lib/cases/discovery";
import { relationEdges, type DerivedPoint } from "@/lib/cases/derive";
import {
  similarityNote,
  SEED_WATCHES,
  allowPerson,
  contentHash,
  hostOf,
  isCaseStatus,
  isCaseType,
  isEvidence,
  isPersonRole,
  isRegion,
  leadsFromCitations,
  rejectAsFact,
  type CaseStatus,
  type CaseType,
  type CitationHit,
  type EvidenceClass,
  type PersonRole,
  type Region,
} from "@/lib/cases/engine";
import {
  draftFromHit,
  matchDuplicate,
  researchOutcome,
  type CaseDraft,
  type KnownRecord,
} from "@/lib/cases/intake";

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return value ? new Date(String(value)).toISOString() : "";
}

async function sql() {
  return getSql();
}

export async function ensureDesk(userId: string) {
  const db = await sql();
  const existing = await db<{ url: string }>`select url from ci_watches where user_id = ${userId}`;
  const have = new Set(existing.map((row) => row.url));
  for (const seed of SEED_WATCHES) {
    if (have.has(seed.url)) continue;
    await db`
      insert into ci_watches (id, user_id, url, title, region)
      values (${crypto.randomUUID()}, ${userId}, ${seed.url}, ${seed.title}, ${seed.region})
      on conflict (user_id, url) do nothing
    `;
  }
}

export async function recordJob(
  userId: string,
  input: { agent: string; kind: string; region?: string; status: string; web?: boolean; reason: string; result: string },
) {
  const db = await sql();
  const id = crypto.randomUUID();
  await db`
    insert into ci_desk_jobs (id, user_id, agent, kind, region, status, web, reason, result_note, finished_at)
    values (
      ${id}, ${userId}, ${input.agent}, ${input.kind}, ${input.region ?? ""}, ${input.status}, ${Boolean(input.web)},
      ${input.reason.slice(0, 500)}, ${input.result.slice(0, 2000)}, now()
    )
  `;
  return id;
}

async function hoursSince(userId: string, kind: string): Promise<number | null> {
  const db = await sql();
  const rows = await db<{ finished_at: unknown }>`
    select finished_at from ci_desk_jobs
    where user_id = ${userId} and kind = ${kind} and status = 'done'
    order by finished_at desc limit 1
  `;
  const value = rows[0]?.finished_at;
  if (!value) return null;
  const time = Date.parse(iso(value));
  if (Number.isNaN(time)) return null;
  return (Date.now() - time) / 3_600_000;
}

export async function loadSignals(userId: string) {
  await ensureDesk(userId);
  const db = await sql();
  const scans = await db<{ region: string; finished_at: unknown }>`
    select region, max(finished_at) as finished_at from ci_desk_jobs
    where user_id = ${userId} and kind = 'scan_region' and status = 'done'
    group by region
  `;
  const lastScan: Partial<Record<Region, string>> = {};
  for (const row of scans) {
    if (isRegion(row.region)) lastScan[row.region] = iso(row.finished_at);
  }
  const stale = await db<{ n: number }>`
    select count(*)::int as n from ci_watches
    where user_id = ${userId}
      and (last_checked_at is null or last_checked_at < now() - interval '12 hours')
  `;
  const gaps = await db<{ n: number }>`
    select count(*)::int as n from ci_cases c
    where c.user_id = ${userId}
      and not exists (
        select 1 from ci_case_items i
        where i.case_id = c.id and i.user_id = c.user_id and i.source_url <> ''
      )
  `;
  const cold = await db<{ n: number }>`
    select count(*)::int as n from ci_cases where user_id = ${userId} and case_status = 'cold'
  `;
  const comparable = await db<{ n: number }>`
    select count(*)::int as n from ci_cases where user_id = ${userId}
  `;
  return {
    now: new Date(),
    lastScan,
    staleWatches: Number(stale[0]?.n ?? 0),
    casesMissingSource: Number(gaps[0]?.n ?? 0),
    hoursSinceContradiction: await hoursSince(userId, "contradiction_scan"),
    hoursSinceCold: await hoursSince(userId, "cold_review"),
    hoursSinceBenchmark: await hoursSince(userId, "benchmark"),
    hoursSinceDiscovery: await hoursSince(userId, "discovery"),
    comparableCases: Number(comparable[0]?.n ?? 0),
    coldCases: Number(cold[0]?.n ?? 0),
    webAllowed: true,
  };
}

export type CaseInput = {
  title: string;
  region: Region;
  stateName?: string;
  district?: string;
  city?: string;
  place?: string;
  caseType: CaseType;
  caseStatus: CaseStatus;
  investigationStatus?: string;
  authority?: string;
  courtName?: string;
  summary?: string;
  abroadRelevant?: boolean;
  openedOn?: string;
};

export async function createCase(userId: string, input: CaseInput) {
  const title = input.title.trim().slice(0, 180);
  if (title.length < 4) throw new Error("Der Titel ist zu kurz.");
  const summary = (input.summary ?? "").trim().slice(0, 4000);
  const blocked = summary ? rejectAsFact(summary, "unknown") : null;
  if (blocked) throw new Error(blocked);
  const db = await sql();
  const id = crypto.randomUUID();
  const prefix = { karlsruhe: "KA", stuttgart: "S", mannheim: "MA", rastatt: "RA", bw: "BW", de: "DE" }[input.region];
  const code = `${prefix}-${id.slice(0, 8)}`;
  await db`
    insert into ci_cases (
      id, user_id, code, title, region, state_name, district, city, place, case_type, case_status,
      investigation_status, authority, court_name, summary, abroad_relevant, opened_on
    ) values (
      ${id}, ${userId}, ${code}, ${title}, ${input.region}, ${(input.stateName ?? "").slice(0, 80)},
      ${(input.district ?? "").slice(0, 80)}, ${(input.city ?? "").slice(0, 80)}, ${(input.place ?? "").slice(0, 120)},
      ${input.caseType}, ${input.caseStatus}, ${(input.investigationStatus ?? "").slice(0, 160)},
      ${(input.authority ?? "").slice(0, 160)}, ${(input.courtName ?? "").slice(0, 160)}, ${summary},
      ${Boolean(input.abroadRelevant)}, ${(input.openedOn ?? "").slice(0, 40)}
    )
  `;
  return { id, code };
}

export async function listCases(userId: string, filter: { region?: string; status?: string; caseType?: string }) {
  const db = await sql();
  const rows = await db<{
    id: string;
    code: string;
    title: string;
    region: string;
    city: string;
    place: string;
    case_type: string;
    case_status: string;
    updated_at: unknown;
  }>`
    select id, code, title, region, city, place, case_type, case_status, updated_at
    from ci_cases where user_id = ${userId}
    order by updated_at desc limit 200
  `;
  return rows
    .filter((row) => !filter.region || row.region === filter.region)
    .filter((row) => !filter.status || row.case_status === filter.status)
    .filter((row) => !filter.caseType || row.case_type === filter.caseType)
    .map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      region: row.region,
      city: row.city,
      place: row.place,
      caseType: row.case_type,
      caseStatus: row.case_status,
      updatedAt: iso(row.updated_at),
    }));
}

export async function getCaseFile(userId: string, id: string) {
  const db = await sql();
  const cases = await db<Record<string, unknown>>`select * from ci_cases where id = ${id} and user_id = ${userId} limit 1`;
  const row = cases[0];
  if (!row) return null;
  const [events, items, people, hypotheses, contradictions, edges, alerts] = await Promise.all([
    db<Record<string, unknown>>`select * from ci_case_events where case_id = ${id} and user_id = ${userId} order by occurred_on, created_at`,
    db<Record<string, unknown>>`select * from ci_case_items where case_id = ${id} and user_id = ${userId} order by created_at`,
    db<Record<string, unknown>>`select * from ci_case_people where case_id = ${id} and user_id = ${userId} order by created_at`,
    db<Record<string, unknown>>`select * from ci_case_hypotheses where case_id = ${id} and user_id = ${userId} order by created_at`,
    db<Record<string, unknown>>`select * from ci_case_contradictions where case_id = ${id} and user_id = ${userId} order by created_at`,
    db<Record<string, unknown>>`select * from ci_case_edges where case_id = ${id} and user_id = ${userId} order by created_at`,
    db<Record<string, unknown>>`select * from ci_case_alerts where case_id = ${id} and user_id = ${userId} order by created_at desc limit 20`,
  ]);
  return {
    case: {
      id: text(row.id),
      code: text(row.code),
      title: text(row.title),
      region: text(row.region),
      stateName: text(row.state_name),
      district: text(row.district),
      city: text(row.city),
      place: text(row.place),
      caseType: text(row.case_type),
      caseStatus: text(row.case_status),
      investigationStatus: text(row.investigation_status),
      authority: text(row.authority),
      courtName: text(row.court_name),
      summary: text(row.summary),
      abroadRelevant: flag(row.abroad_relevant),
      openedOn: text(row.opened_on),
      updatedAt: iso(row.updated_at),
    },
    events: events.map((event) => ({
      id: text(event.id),
      occurredOn: text(event.occurred_on),
      label: text(event.label),
      detail: text(event.detail),
      evidence: text(event.evidence_class),
      sourceUrl: text(event.source_url),
      historical: flag(event.historical),
    })),
    items: items.map((item) => ({
      id: text(item.id),
      kind: text(item.kind),
      evidence: text(item.evidence_class),
      body: text(item.body),
      sourceUrl: text(item.source_url),
      historical: flag(item.historical),
    })),
    people: people.map((person) => ({
      id: text(person.id),
      name: text(person.name),
      role: text(person.role),
      evidence: text(person.evidence_class),
      note: text(person.note),
      sourceUrl: text(person.source_url),
      personId: text(person.person_id),
    })),
    hypotheses: hypotheses.map((item) => ({
      id: text(item.id),
      title: text(item.title),
      support: text(item.support_text),
      contradict: text(item.contradict_text),
      unknown: text(item.unknown_text),
      alternatives: text(item.alternatives),
      status: text(item.status),
    })),
    contradictions: contradictions.map((item) => ({
      id: text(item.id),
      kind: text(item.kind),
      left: text(item.left_text),
      right: text(item.right_text),
      note: text(item.note),
    })),
    edges: edges.map((edge) => ({
      id: text(edge.id),
      from: text(edge.from_label),
      relation: text(edge.relation),
      to: text(edge.to_label),
      proven: flag(edge.proven),
      note: text(edge.note),
    })),
    alerts: alerts.map((alert) => ({
      id: text(alert.id),
      title: text(alert.title),
      body: text(alert.body),
      source: text(alert.source_label),
      evidence: text(alert.evidence_class),
      seen: flag(alert.seen),
      createdAt: iso(alert.created_at),
    })),
  };
}

export async function addEvent(userId: string, input: { caseId: string; occurredOn: string; label: string; detail: string; evidence: EvidenceClass; sourceUrl: string; historical?: boolean }) {
  const blocked = rejectAsFact(`${input.label} ${input.detail}`, input.evidence);
  if (blocked) throw new Error(blocked);
  const db = await sql();
  await db`
    insert into ci_case_events (id, user_id, case_id, occurred_on, label, detail, evidence_class, source_url, historical)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.occurredOn.slice(0, 40)}, ${input.label.slice(0, 180)},
      ${input.detail.slice(0, 2000)}, ${input.evidence}, ${input.sourceUrl.slice(0, 500)}, ${Boolean(input.historical)}
    )
  `;
  await db`update ci_cases set updated_at = now() where id = ${input.caseId} and user_id = ${userId}`;
}

export async function addItem(userId: string, input: { caseId: string; kind: string; evidence: EvidenceClass; body: string; sourceUrl: string; historical?: boolean }) {
  const blocked = rejectAsFact(input.body, input.evidence);
  if (blocked) throw new Error(blocked);
  const db = await sql();
  await db`
    insert into ci_case_items (id, user_id, case_id, kind, evidence_class, body, source_url, historical)
    values (${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.kind.slice(0, 40)}, ${input.evidence}, ${input.body.slice(0, 4000)}, ${input.sourceUrl.slice(0, 500)}, ${Boolean(input.historical)})
  `;
  await db`update ci_cases set updated_at = now() where id = ${input.caseId} and user_id = ${userId}`;
}

export async function updateCase(
  userId: string,
  id: string,
  input: {
    caseStatus: CaseStatus;
    investigationStatus: string;
    authority: string;
    courtName: string;
    city: string;
    district: string;
    place: string;
    summary: string;
  },
) {
  const db = await sql();
  const rows = await db<{ id: string }>`select id from ci_cases where id = ${id} and user_id = ${userId} limit 1`;
  if (!rows.length) throw new Error("Fall nicht gefunden.");
  const blocked = rejectAsFact(input.summary, "unknown");
  if (blocked) throw new Error(blocked);
  await db`
    update ci_cases set
      case_status = ${input.caseStatus},
      investigation_status = ${input.investigationStatus.slice(0, 160)},
      authority = ${input.authority.slice(0, 160)},
      court_name = ${input.courtName.slice(0, 160)},
      city = ${input.city.slice(0, 80)},
      district = ${input.district.slice(0, 80)},
      place = ${input.place.slice(0, 120)},
      summary = ${input.summary.slice(0, 4000)},
      updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

export async function markHistorical(userId: string, input: { kind: "event" | "item"; id: string }) {
  const db = await sql();
  if (input.kind === "event") {
    await db`update ci_case_events set historical = true where id = ${input.id} and user_id = ${userId}`;
    return;
  }
  await db`update ci_case_items set historical = true where id = ${input.id} and user_id = ${userId}`;
}

export async function addPerson(userId: string, input: { caseId: string; name: string; role: PersonRole; evidence: EvidenceClass; note: string; sourceUrl: string }) {
  const blocked = allowPerson(input.role, input.evidence) ?? rejectAsFact(input.note, input.evidence);
  if (blocked) throw new Error(blocked);
  const db = await sql();
  const id = crypto.randomUUID();
  await db`
    insert into ci_case_people (id, user_id, case_id, name, role, evidence_class, note, source_url)
    values (
      ${id}, ${userId}, ${input.caseId}, ${input.name.slice(0, 140)}, ${input.role}, ${input.evidence},
      ${input.note.slice(0, 1000)}, ${input.sourceUrl.slice(0, 500)}
    )
  `;
  return { id };
}

export async function addHypothesis(userId: string, input: { caseId: string; title: string; support: string; contradict: string; unknown: string; alternatives: string }) {
  const blocked = rejectAsFact(input.title, "hypothesis");
  if (blocked) throw new Error(blocked);
  const db = await sql();
  await db`
    insert into ci_case_hypotheses (id, user_id, case_id, title, support_text, contradict_text, unknown_text, alternatives)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.title.slice(0, 180)}, ${input.support.slice(0, 2000)},
      ${input.contradict.slice(0, 2000)}, ${input.unknown.slice(0, 2000)}, ${input.alternatives.slice(0, 2000)}
    )
  `;
}

export async function addEdge(userId: string, input: { caseId: string; from: string; relation: string; to: string; proven: boolean; note: string }) {
  if (input.proven && input.note.trim().length < 12) throw new Error("Eine belegte Verbindung braucht eine kurze Begründung aus der Quelle.");
  const db = await sql();
  await db`
    insert into ci_case_edges (id, user_id, case_id, from_label, relation, to_label, proven, note)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.from.slice(0, 140)}, ${input.relation.slice(0, 80)},
      ${input.to.slice(0, 140)}, ${input.proven}, ${input.note.slice(0, 500)}
    )
  `;
}

export async function insertLead(userId: string, input: { region: Region; title: string; url: string; snippet: string; evidence: EvidenceClass; kind: string; originKey: string; publisher: string }) {
  const db = await sql();
  const existing = await db<{ id: string }>`
    select id from ci_leads where user_id = ${userId} and origin_key = ${input.originKey} limit 1
  `;
  if (existing.length) return { id: existing[0].id, fresh: false };
  const id = crypto.randomUUID();
  await db`
    insert into ci_leads (id, user_id, region, title, url, snippet, evidence_class, source_kind, origin_key, publisher)
    values (
      ${id}, ${userId}, ${input.region}, ${input.title.slice(0, 200)}, ${input.url.slice(0, 500)}, ${input.snippet.slice(0, 1000)},
      ${input.evidence}, ${input.kind}, ${input.originKey.slice(0, 200)}, ${input.publisher.slice(0, 120)}
    )
  `;
  return { id, fresh: true };
}

export async function listLeads(userId: string) {
  const db = await sql();
  const rows = await db<{
    id: string;
    region: string;
    title: string;
    url: string;
    snippet: string;
    evidence_class: string;
    source_kind: string;
    status: string;
    created_at: unknown;
  }>`
    select id, region, title, url, snippet, evidence_class, source_kind, status, created_at
    from ci_leads where user_id = ${userId} and status = 'open'
    order by created_at desc limit 80
  `;
  return rows.map((row) => ({
    id: row.id,
    region: row.region,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    evidence: row.evidence_class,
    kind: row.source_kind,
    status: row.status,
    createdAt: iso(row.created_at),
  }));
}

export async function findCaseByTitle(userId: string, title: string) {
  const db = await sql();
  const rows = await db<{ id: string; title: string }>`select id, title from ci_cases where user_id = ${userId} order by updated_at desc limit 200`;
  let best: { id: string; score: number } | null = null;
  for (const row of rows) {
    const score = jaccard(title, row.title);
    if (score >= 0.42 && (!best || score > best.score)) best = { id: row.id, score };
  }
  return best;
}

export async function addAlert(userId: string, input: { caseId?: string | null; title: string; body: string; source: string; evidence: EvidenceClass }) {
  const db = await sql();
  await db`
    insert into ci_case_alerts (id, user_id, case_id, title, body, source_label, evidence_class)
    values (
      ${crypto.randomUUID()}, ${userId}, ${input.caseId ?? null}, ${input.title.slice(0, 180)}, ${input.body.slice(0, 2000)},
      ${input.source.slice(0, 200)}, ${input.evidence}
    )
  `;
}

export async function promoteLead(userId: string, id: string) {
  const db = await sql();
  const rows = await db<{ id: string; region: string; title: string; url: string; snippet: string; evidence_class: string }>`
    select id, region, title, url, snippet, evidence_class from ci_leads where id = ${id} and user_id = ${userId} and status = 'open' limit 1
  `;
  const lead = rows[0];
  if (!lead || !isRegion(lead.region) || !isEvidence(lead.evidence_class)) throw new Error("Hinweis nicht gefunden.");
  const created = await createCase(userId, {
    title: lead.title,
    region: lead.region,
    caseType: "unsolved",
    caseStatus: "open",
    summary: lead.snippet,
  });
  if (lead.url) {
    await addItem(userId, { caseId: created.id, kind: "source", evidence: lead.evidence_class, body: lead.snippet || lead.title, sourceUrl: lead.url });
  }
  await db`update ci_leads set status = 'promoted', case_id = ${created.id} where id = ${id} and user_id = ${userId}`;
  return created;
}

export async function dismissLead(userId: string, id: string) {
  const db = await sql();
  await db`update ci_leads set status = 'dismissed' where id = ${id} and user_id = ${userId}`;
}

export async function attachLead(userId: string, leadId: string, caseId: string) {
  const db = await sql();
  const rows = await db<{ title: string; url: string; snippet: string; evidence_class: string }>`
    select title, url, snippet, evidence_class from ci_leads where id = ${leadId} and user_id = ${userId} and status = 'open' limit 1
  `;
  const lead = rows[0];
  if (!lead || !isEvidence(lead.evidence_class)) throw new Error("Hinweis nicht gefunden.");
  await addItem(userId, { caseId, kind: "update", evidence: lead.evidence_class, body: lead.snippet || lead.title, sourceUrl: lead.url });
  await addAlert(userId, { caseId, title: "Neue Quelle zu bestehendem Fall", body: lead.title, source: lead.url, evidence: lead.evidence_class });
  await db`update ci_leads set status = 'attached', case_id = ${caseId} where id = ${leadId} and user_id = ${userId}`;
}

async function loadKnown(userId: string): Promise<KnownRecord[]> {
  const db = await sql();
  const cases = await db<{ id: string; title: string; city: string; opened_on: string; case_type: string }>`
    select id, title, city, opened_on, case_type from ci_cases where user_id = ${userId} order by updated_at desc limit 200
  `;
  const items = await db<{ case_id: string; source_url: string }>`
    select case_id, source_url from ci_case_items where user_id = ${userId} and source_url <> '' limit 400
  `;
  const candidates = await db<{ id: string; title: string; city: string; opened_on: string; case_type: string; source_url: string; origin_key: string; case_id: string | null }>`
    select id, title, city, opened_on, case_type, source_url, origin_key, case_id
    from ci_case_candidates where user_id = ${userId} order by updated_at desc limit 200
  `;
  const urls = new Map<string, string[]>();
  for (const item of items) {
    const list = urls.get(item.case_id) ?? [];
    list.push(item.source_url);
    urls.set(item.case_id, list);
  }
  const fromCases: KnownRecord[] = cases.map((row) => ({
    id: row.id,
    kind: "case",
    title: row.title,
    city: row.city,
    openedOn: row.opened_on,
    caseType: row.case_type,
    sourceUrls: urls.get(row.id) ?? [],
    originKeys: candidates.filter((item) => item.case_id === row.id && item.origin_key).map((item) => item.origin_key),
  }));
  const fromCandidates: KnownRecord[] = candidates.map((row) => ({
    id: row.id,
    kind: "candidate",
    title: row.title,
    city: row.city,
    openedOn: row.opened_on,
    caseType: row.case_type,
    sourceUrls: row.source_url ? [row.source_url] : [],
    originKeys: row.origin_key ? [row.origin_key] : [],
  }));
  return [...fromCases, ...fromCandidates];
}

async function rememberCaseSource(userId: string, draft: CaseDraft): Promise<{ id: string; fresh: boolean }> {
  const db = await sql();
  const existing = await db<{ id: string }>`select id from ci_sources where user_id = ${userId} and url = ${draft.sourceUrl} limit 1`;
  if (existing[0]) return { id: existing[0].id, fresh: false };
  const id = crypto.randomUUID();
  const reliability = draft.evidence === "official" || draft.evidence === "court" ? "high" : draft.evidence === "documented" ? "medium" : "low";
  await db`
    insert into ci_sources (id, user_id, url, title, kind, reliability, note, checked_at, content_hash, publisher, independence_status)
    values (
      ${id}, ${userId}, ${draft.sourceUrl.slice(0, 500)}, ${draft.title.slice(0, 180)}, ${draft.kind}, ${reliability},
      ${draft.summary.slice(0, 500)}, now(), ${contentHash(draft.sourceUrl)}, ${hostOf(draft.sourceUrl).slice(0, 120)}, 'unknown'
    )
  `;
  return { id, fresh: true };
}

async function insertCandidate(userId: string, draft: CaseDraft, sourceId: string, status: string, caseId: string | null) {
  const db = await sql();
  const existing = draft.originKey
    ? await db<{ id: string; source_ids: string }>`
        select id, source_ids from ci_case_candidates where user_id = ${userId} and origin_key = ${draft.originKey} limit 1
      `
    : [];
  if (existing[0]) {
    const ids = existing[0].source_ids.split(",").map((item) => item.trim()).filter(Boolean);
    if (!ids.includes(sourceId)) ids.push(sourceId);
    await db`
      update ci_case_candidates set source_ids = ${ids.join(",")}, updated_at = now()
      where id = ${existing[0].id} and user_id = ${userId}
    `;
    return { id: existing[0].id, fresh: false };
  }
  const id = crypto.randomUUID();
  await db`
    insert into ci_case_candidates (
      id, user_id, title, region, city, case_type, case_status, opened_on, summary, source_ids, source_url,
      origin_key, evidence_class, confidence, status, missing_note, case_id
    ) values (
      ${id}, ${userId}, ${draft.title}, ${draft.region}, ${draft.city}, ${draft.caseType}, ${draft.caseStatus},
      ${draft.openedOn}, ${draft.summary}, ${sourceId}, ${draft.sourceUrl.slice(0, 500)}, ${draft.originKey.slice(0, 200)},
      ${draft.evidence}, ${draft.confidence}, ${status}, ${draft.missing.join(", ")}, ${caseId}
    )
  `;
  return { id, fresh: true };
}

async function adoptDraft(userId: string, draft: CaseDraft, candidateId: string) {
  const stateName = draft.region === "de" ? "" : "Baden-Württemberg";
  const created = await createCase(userId, {
    title: draft.title,
    region: draft.region,
    stateName,
    city: draft.city,
    caseType: draft.caseType,
    caseStatus: draft.caseStatus,
    summary: draft.summary,
    openedOn: draft.openedOn,
  });
  await addItem(userId, {
    caseId: created.id,
    kind: "source",
    evidence: draft.evidence,
    body: draft.summary,
    sourceUrl: draft.sourceUrl,
  });
  const db = await sql();
  await db`
    update ci_case_candidates
    set status = 'verified_public', case_id = ${created.id}, updated_at = now()
    where id = ${candidateId} and user_id = ${userId}
  `;
  await db`update ci_sources set case_id = ${created.id} where user_id = ${userId} and url = ${draft.sourceUrl}`;
  return created;
}

export async function settlePublicHits(userId: string, hits: CitationHit[]) {
  const { kept, dropped } = leadsFromCitations(hits);
  let adopted = 0;
  let waiting = 0;
  let duplicates = 0;
  let sources = 0;
  for (const lead of kept) {
    const draft = draftFromHit({
      url: lead.url,
      title: lead.title ?? "",
      snippet: lead.snippet ?? "",
      region: lead.region,
      evidence: lead.evidence,
      kind: lead.kind,
      originKey: lead.originKey,
    });
    if (!draft) {
      const match = await findCaseByTitle(userId, lead.title ?? "");
      if (match) {
        await addAlert(userId, {
          caseId: match.id,
          title: "Mögliche Aktualisierung",
          body: lead.title || lead.url,
          source: lead.url,
          evidence: lead.evidence,
        });
        duplicates += 1;
      } else {
        await insertLead(userId, {
          region: lead.region,
          title: lead.title || lead.url,
          url: lead.url,
          snippet: lead.snippet ?? "",
          evidence: lead.evidence,
          kind: lead.kind,
          originKey: lead.originKey,
          publisher: lead.kind,
        });
      }
      continue;
    }
    const source = await rememberCaseSource(userId, draft);
    if (source.fresh) sources += 1;
    const duplicate = matchDuplicate(draft, await loadKnown(userId));
    if (duplicate) {
      if (duplicate.kind === "case") {
        await addAlert(userId, {
          caseId: duplicate.id,
          title: "Quelle zu bestehendem Fall",
          body: draft.title,
          source: draft.sourceUrl,
          evidence: draft.evidence,
        });
        const db = await sql();
        const present = await db<{ id: string }>`
          select id from ci_case_items where user_id = ${userId} and case_id = ${duplicate.id} and source_url = ${draft.sourceUrl} limit 1
        `;
        if (!present.length) {
          await addItem(userId, { caseId: duplicate.id, kind: "source", evidence: draft.evidence, body: draft.summary, sourceUrl: draft.sourceUrl });
        }
      }
      await insertCandidate(userId, draft, source.id, "duplicate", duplicate.kind === "case" ? duplicate.id : null);
      duplicates += 1;
      continue;
    }
    const saved = await insertCandidate(userId, draft, source.id, draft.adoptable ? "candidate" : "needs_review", null);
    if (!saved.fresh) {
      duplicates += 1;
      continue;
    }
    if (draft.adoptable) {
      await adoptDraft(userId, draft, saved.id);
      adopted += 1;
    } else {
      waiting += 1;
    }
  }
  return {
    note: researchOutcome({ citations: kept.length, adopted, waiting, duplicates }),
    adopted,
    waiting,
    duplicates,
    sources,
    dropped,
  };
}

export async function listCandidates(userId: string) {
  const db = await sql();
  const rows = await db<{
    id: string;
    title: string;
    region: string;
    city: string;
    case_type: string;
    case_status: string;
    opened_on: string;
    summary: string;
    source_ids: string;
    source_url: string;
    evidence_class: string;
    confidence: string;
    status: string;
    missing_note: string;
    case_id: string | null;
    created_at: unknown;
    updated_at: unknown;
  }>`
    select id, title, region, city, case_type, case_status, opened_on, summary, source_ids, source_url,
      evidence_class, confidence, status, missing_note, case_id, created_at, updated_at
    from ci_case_candidates where user_id = ${userId}
    order by updated_at desc limit 40
  `;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    region: row.region,
    city: row.city,
    caseType: row.case_type,
    caseStatus: row.case_status,
    openedOn: row.opened_on,
    summary: row.summary,
    sourceIds: row.source_ids.split(",").map((item) => item.trim()).filter(Boolean),
    sourceUrl: row.source_url,
    evidence: row.evidence_class,
    confidence: row.confidence,
    status: row.status,
    missing: row.missing_note,
    caseId: row.case_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function reviewOpenCandidates(userId: string) {
  const db = await sql();
  const rows = await db<{
    id: string;
    title: string;
    region: string;
    city: string;
    case_type: string;
    case_status: string;
    opened_on: string;
    summary: string;
    source_url: string;
    origin_key: string;
    evidence_class: string;
    status: string;
  }>`
    select id, title, region, city, case_type, case_status, opened_on, summary, source_url, origin_key, evidence_class, status
    from ci_case_candidates
    where user_id = ${userId} and case_id is null and status in ('candidate', 'needs_review')
    order by created_at asc limit 40
  `;
  if (!rows.length) return { note: researchOutcome({ citations: 0, adopted: 0, waiting: 0, duplicates: 0 }), adopted: 0, waiting: 0, duplicates: 0 };
  let adopted = 0;
  let waiting = 0;
  let duplicates = 0;
  for (const row of rows) {
    if (!isRegion(row.region) || !isEvidence(row.evidence_class) || !isCaseType(row.case_type) || !isCaseStatus(row.case_status)) {
      waiting += 1;
      continue;
    }
    const draft: CaseDraft = {
      title: row.title,
      region: row.region,
      city: row.city,
      caseType: row.case_type,
      caseStatus: row.case_status,
      openedOn: row.opened_on,
      summary: row.summary,
      sourceUrl: row.source_url,
      originKey: row.origin_key,
      evidence: row.evidence_class,
      kind: "other",
      confidence: "limited",
      status: row.status === "needs_review" ? "needs_review" : "candidate",
      missing: [],
      adoptable: row.evidence_class === "official" || row.evidence_class === "court" || row.evidence_class === "documented",
    };
    if (!draft.adoptable || draft.status === "needs_review") {
      waiting += 1;
      continue;
    }
    const duplicate = matchDuplicate(draft, (await loadKnown(userId)).filter((item) => item.id !== row.id));
    if (duplicate) {
      await db`
        update ci_case_candidates
        set status = 'duplicate', case_id = ${duplicate.kind === "case" ? duplicate.id : null}, updated_at = now()
        where id = ${row.id} and user_id = ${userId}
      `;
      duplicates += 1;
      continue;
    }
    await adoptDraft(userId, draft, row.id);
    adopted += 1;
  }
  const note = adopted === 0 && duplicates === 0
    ? "Keine weiteren Fälle zur Übernahme. Unbelegte Kandidaten bleiben zur Prüfung."
    : researchOutcome({ citations: rows.length, adopted, waiting, duplicates });
  return { note, adopted, waiting, duplicates };
}

export async function decideCandidate(userId: string, id: string, accept: boolean) {
  const db = await sql();
  const rows = await db<{
    id: string;
    title: string;
    region: string;
    city: string;
    case_type: string;
    case_status: string;
    opened_on: string;
    summary: string;
    source_url: string;
    origin_key: string;
    evidence_class: string;
    case_id: string | null;
    status: string;
  }>`
    select id, title, region, city, case_type, case_status, opened_on, summary, source_url, origin_key, evidence_class, case_id, status
    from ci_case_candidates where id = ${id} and user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Fallkandidat nicht gefunden.");
  if (!accept) {
    await db`update ci_case_candidates set status = 'rejected', updated_at = now() where id = ${id} and user_id = ${userId}`;
    return { ok: true as const, caseId: row.case_id };
  }
  if (row.case_id) return { ok: true as const, caseId: row.case_id };
  if (!isRegion(row.region) || !isCaseType(row.case_type) || !isCaseStatus(row.case_status) || !isEvidence(row.evidence_class)) {
    throw new Error("Der Kandidat ist unvollständig.");
  }
  const created = await createCase(userId, {
    title: row.title,
    region: row.region,
    stateName: row.region === "de" ? "" : "Baden-Württemberg",
    city: row.city,
    caseType: row.case_type,
    caseStatus: row.case_status,
    summary: row.summary,
    openedOn: row.opened_on,
  });
  if (row.source_url) {
    await addItem(userId, { caseId: created.id, kind: "source", evidence: row.evidence_class, body: row.summary || row.title, sourceUrl: row.source_url });
  }
  const verified = row.evidence_class === "official" || row.evidence_class === "court" || row.evidence_class === "documented";
  await db`
    update ci_case_candidates
    set case_id = ${created.id}, status = ${verified ? "verified_public" : "needs_review"}, updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
  return { ok: true as const, caseId: created.id };
}

export async function listOpenAlerts(userId: string) {
  const db = await sql();
  const rows = await db<{ id: string; case_id: string | null; title: string; body: string; source_label: string; evidence_class: string; created_at: unknown }>`
    select id, case_id, title, body, source_label, evidence_class, created_at
    from ci_case_alerts where user_id = ${userId} and seen = false
    order by created_at desc limit 40
  `;
  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    title: row.title,
    body: row.body,
    source: row.source_label,
    evidence: row.evidence_class,
    createdAt: iso(row.created_at),
  }));
}

export async function markAlertSeen(userId: string, id: string) {
  const db = await sql();
  await db`update ci_case_alerts set seen = true where id = ${id} and user_id = ${userId}`;
}

export async function listWatches(userId: string) {
  await ensureDesk(userId);
  const db = await sql();
  const rows = await db<{ id: string; url: string; title: string; region: string; content_hash: string; last_checked_at: unknown; last_changed_at: unknown; note: string }>`
    select id, url, title, region, content_hash, last_checked_at, last_changed_at, note
    from ci_watches where user_id = ${userId} order by region, title
  `;
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    region: row.region,
    hash: row.content_hash,
    checkedAt: row.last_checked_at ? iso(row.last_checked_at) : null,
    changedAt: row.last_changed_at ? iso(row.last_changed_at) : null,
    note: row.note,
  }));
}

export async function nextStaleWatch(userId: string) {
  const db = await sql();
  const rows = await db<{ id: string; url: string; title: string; content_hash: string }>`
    select id, url, title, content_hash from ci_watches
    where user_id = ${userId} and (last_checked_at is null or last_checked_at < now() - interval '12 hours')
    order by last_checked_at nulls first limit 1
  `;
  return rows[0] ?? null;
}

export async function saveWatchCheck(userId: string, id: string, input: { hash: string; changed: boolean; note: string }) {
  const db = await sql();
  if (input.changed) {
    await db`
      update ci_watches
      set content_hash = ${input.hash}, last_checked_at = now(), last_changed_at = now(), note = ${input.note.slice(0, 500)}
      where id = ${id} and user_id = ${userId}
    `;
    return;
  }
  await db`
    update ci_watches
    set content_hash = ${input.hash}, last_checked_at = now(), note = ${input.note.slice(0, 500)}
    where id = ${id} and user_id = ${userId}
  `;
}

export async function casesMissingSource(userId: string) {
  const db = await sql();
  return db<{ id: string; title: string; code: string }>`
    select c.id, c.title, c.code from ci_cases c
    where c.user_id = ${userId}
      and not exists (
        select 1 from ci_case_items i where i.case_id = c.id and i.user_id = c.user_id and i.source_url <> ''
      )
    limit 20
  `;
}

export async function listColdCases(userId: string) {
  const db = await sql();
  return db<{ id: string; code: string; title: string; city: string }>`
    select id, code, title, city from ci_cases where user_id = ${userId} and case_status = 'cold' limit 30
  `;
}

export async function itemsForContradiction(userId: string) {
  const db = await sql();
  return db<{ id: string; case_id: string; body: string; evidence_class: string }>`
    select id, case_id, body, evidence_class from ci_case_items where user_id = ${userId} order by created_at desc limit 80
  `;
}

export async function contradictionExists(userId: string, left: string, right: string) {
  const db = await sql();
  const rows = await db<{ id: string }>`
    select id from ci_case_contradictions
    where user_id = ${userId} and left_text = ${left} and right_text = ${right} limit 1
  `;
  return rows.length > 0;
}

export async function addContradiction(userId: string, input: { caseId: string; kind: string; left: string; right: string; note: string }) {
  const db = await sql();
  await db`
    insert into ci_case_contradictions (id, user_id, case_id, kind, left_text, right_text, note)
    values (${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.kind}, ${input.left.slice(0, 1000)}, ${input.right.slice(0, 1000)}, ${input.note.slice(0, 500)})
  `;
}

export async function loadBoard(userId: string) {
  await ensureDesk(userId);
  const db = await sql();
  const cases = await db<{ id: string; title: string; region: string; city: string; place: string; case_status: string; case_type: string }>`
    select id, title, region, city, place, case_status, case_type from ci_cases where user_id = ${userId}
  `;
  const leads = await db<{ n: number }>`select count(*)::int as n from ci_leads where user_id = ${userId} and status = 'open'`;
  const alerts = await db<{ n: number }>`select count(*)::int as n from ci_case_alerts where user_id = ${userId} and seen = false`;
  const contradictions = await db<{ n: number }>`select count(*)::int as n from ci_case_contradictions where user_id = ${userId} and kind in ('direct', 'possible')`;
  const sources = await db<{ n: number }>`select count(*)::int as n from ci_case_items where user_id = ${userId} and source_url <> ''`;
  const verified = await db<{ n: number }>`select count(*)::int as n from ci_case_items where user_id = ${userId} and evidence_class in ('official', 'court')`;
  const openCandidates = await db<{ n: number }>`
    select count(*)::int as n from ci_case_candidates
    where user_id = ${userId} and case_id is null and status in ('candidate', 'needs_review')
  `;
  const adopted = await db<{ n: number }>`
    select count(*)::int as n from ci_case_candidates
    where user_id = ${userId} and case_id is not null and status in ('verified_public', 'candidate', 'needs_review')
  `;
  const lastResearch = await db<{ result_note: string; finished_at: unknown; region: string }>`
    select result_note, finished_at, region from ci_desk_jobs
    where user_id = ${userId} and kind in ('public_cases', 'scan_region') and status = 'done'
    order by finished_at desc limit 1
  `;
  const jobs = await db<{ id: string; agent: string; kind: string; region: string; status: string; web: boolean; reason: string; result_note: string; finished_at: unknown }>`
    select id, agent, kind, region, status, web, reason, result_note, finished_at
    from ci_desk_jobs where user_id = ${userId} order by finished_at desc limit 12
  `;
  const byRegion = { karlsruhe: 0, stuttgart: 0, mannheim: 0, rastatt: 0, bw: 0, de: 0 };
  let cold = 0;
  let missing = 0;
  const places = new Map<string, { region: string; city: string; place: string; n: number }>();
  for (const row of cases) {
    if (isRegion(row.region)) byRegion[row.region] += 1;
    if (row.case_status === "cold" || row.case_type === "cold") cold += 1;
    if (row.case_type === "missing") missing += 1;
    const city = row.city.trim();
    const place = row.place.trim();
    if (!city && !place) continue;
    const key = `${row.region}|${city}|${place}`;
    const current = places.get(key) ?? { region: row.region, city, place, n: 0 };
    current.n += 1;
    places.set(key, current);
  }
  const patterns: { left: string; right: string; note: string }[] = [];
  const sample = cases.slice(0, 40);
  for (let i = 0; i < sample.length && patterns.length < 8; i += 1) {
    for (let j = i + 1; j < sample.length && patterns.length < 8; j += 1) {
      const sharedType = sample[i].case_type !== "" && sample[i].case_type === sample[j].case_type;
      const sharedPlace = Boolean(sample[i].city.trim()) && sample[i].city.trim() === sample[j].city.trim();
      if (!sharedType && !sharedPlace) continue;
      patterns.push({
        left: sample[i].title,
        right: sample[j].title,
        note: similarityNote(sharedType, sharedPlace, false),
      });
    }
  }
  return {
    regions: byRegion,
    cases: cases.length,
    cold,
    missing,
    leads: Number(leads[0]?.n ?? 0),
    alerts: Number(alerts[0]?.n ?? 0),
    contradictions: Number(contradictions[0]?.n ?? 0),
    sources: Number(sources[0]?.n ?? 0),
    verified: Number(verified[0]?.n ?? 0),
    candidates: Number(openCandidates[0]?.n ?? 0),
    adopted: Number(adopted[0]?.n ?? 0),
    lastResearch: lastResearch[0]
      ? { result: lastResearch[0].result_note, region: lastResearch[0].region, at: iso(lastResearch[0].finished_at) }
      : null,
    places: [...places.values()],
    patterns,
    jobs: jobs.map((job) => ({
      id: job.id,
      agent: job.agent,
      kind: job.kind,
      region: job.region,
      status: job.status,
      web: job.web,
      reason: job.reason,
      result: job.result_note,
      at: iso(job.finished_at),
    })),
  };
}

export function parseCaseInput(data: Record<string, unknown>): CaseInput {
  const region = String(data.region ?? "");
  const caseType = String(data.caseType ?? "");
  const caseStatus = String(data.caseStatus ?? "open");
  if (!isRegion(region) || !isCaseType(caseType) || !isCaseStatus(caseStatus)) throw new Error("Region, Art oder Status ist ungültig.");
  return {
    title: String(data.title ?? ""),
    region,
    stateName: String(data.stateName ?? ""),
    district: String(data.district ?? ""),
    city: String(data.city ?? ""),
    place: String(data.place ?? ""),
    caseType,
    caseStatus,
    investigationStatus: String(data.investigationStatus ?? ""),
    authority: String(data.authority ?? ""),
    courtName: String(data.courtName ?? ""),
    summary: String(data.summary ?? ""),
    abroadRelevant: data.abroadRelevant === true,
    openedOn: String(data.openedOn ?? ""),
  };
}

export function parseEvidence(value: unknown): EvidenceClass {
  const text = String(value ?? "");
  if (!isEvidence(text)) throw new Error("Unbekannte Evidenzklasse.");
  return text;
}

export function parseRole(value: unknown): PersonRole {
  const text = String(value ?? "");
  if (!isPersonRole(text)) throw new Error("Diese Rolle wird nicht geführt.");
  return text;
}

function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

type FeatureRow = FeatureInput & { id: string };

function mapFeature(row: Record<string, unknown>): FeatureRow {
  const origin = text(row.origin);
  return {
    id: text(row.id),
    caseId: text(row.case_id),
    caseTitle: text(row.case_title),
    key: text(row.feature_key),
    value: text(row.feature_value),
    origin: isOrigin(origin) ? origin : "unknown_origin",
    evidence: text(row.evidence_class),
    sourceUrl: text(row.source_url),
    auto: flag(row.auto),
  };
}

async function loadSeeds(userId: string): Promise<CaseSeed[]> {
  const db = await sql();
  const cases = await db<Record<string, unknown>>`
    select id, title, region, city, place, case_type, case_status, opened_on
    from ci_cases where user_id = ${userId} order by updated_at desc limit 80
  `;
  const events = await db<Record<string, unknown>>`
    select case_id, occurred_on, label, evidence_class, source_url
    from ci_case_events where user_id = ${userId} order by created_at desc limit 400
  `;
  const items = await db<Record<string, unknown>>`
    select case_id, body, evidence_class, source_url, kind
    from ci_case_items where user_id = ${userId} order by created_at desc limit 400
  `;
  return cases.map((row) => {
    const id = text(row.id);
    return {
      id,
      title: text(row.title),
      region: text(row.region),
      city: text(row.city),
      place: text(row.place),
      caseType: text(row.case_type),
      caseStatus: text(row.case_status),
      openedOn: text(row.opened_on),
      events: events.filter((event) => text(event.case_id) === id).map((event) => ({
        occurredOn: text(event.occurred_on),
        label: text(event.label),
        evidence: text(event.evidence_class),
        sourceUrl: text(event.source_url),
      })),
      items: items.filter((item) => text(item.case_id) === id).map((item) => ({
        body: text(item.body),
        evidence: text(item.evidence_class),
        sourceUrl: text(item.source_url),
        kind: text(item.kind),
      })),
    };
  });
}

async function listFeatureRows(userId: string, caseId = ""): Promise<FeatureRow[]> {
  const db = await sql();
  const rows = await db<Record<string, unknown>>`
    select f.id, f.case_id, f.feature_key, f.feature_value, f.origin, f.evidence_class, f.source_url, f.auto, c.title as case_title
    from ci_case_features f
    left join ci_cases c on c.id = f.case_id and c.user_id = f.user_id
    where f.user_id = ${userId}
    order by f.created_at desc
    limit 500
  `;
  return rows.map(mapFeature).filter((row) => !caseId || row.caseId === caseId);
}

export async function addUserFeature(
  userId: string,
  input: { caseId: string; key: string; value: string; origin: string; evidence: EvidenceClass; sourceUrl: string },
) {
  if (!isFeatureKey(input.key)) throw new Error("Dieses Merkmal wird nicht geführt.");
  if (!isOrigin(input.origin)) throw new Error("Unbekannte Herkunft.");
  const value = input.value.trim().slice(0, 160);
  if (value.length < 2) throw new Error("Das Merkmal ist zu kurz.");
  const banned = rejectDiscoveryClaim(value) ?? originMatchesEvidence(input.origin, input.evidence) ?? rejectAsFact(value, input.evidence);
  if (banned) throw new Error(banned);
  const db = await sql();
  const owned = await db<{ id: string }>`select id from ci_cases where id = ${input.caseId} and user_id = ${userId} limit 1`;
  if (!owned.length) throw new Error("Akte nicht gefunden.");
  const names = await db<{ name: string }>`select name from ci_case_people where user_id = ${userId} and lower(name) = lower(${value}) limit 1`;
  if (names.length) throw new Error("Namen werden nicht als Quermerkmal verwendet.");
  await db`
    insert into ci_case_features (id, user_id, case_id, feature_key, feature_value, origin, evidence_class, source_url, auto)
    values (${crypto.randomUUID()}, ${userId}, ${input.caseId}, ${input.key}, ${value}, ${input.origin}, ${input.evidence}, ${input.sourceUrl.slice(0, 500)}, false)
  `;
  const compared = await compareStored(userId);
  return { note: compared.note, created: compared.created, unchanged: compared.unchanged };
}

async function replaceAutoFeatures(userId: string, features: FeatureInput[]) {
  const db = await sql();
  await db`delete from ci_case_features where user_id = ${userId} and auto = true`;
  for (const feature of features) {
    await db`
      insert into ci_case_features (id, user_id, case_id, feature_key, feature_value, origin, evidence_class, source_url, auto)
      values (
        ${crypto.randomUUID()}, ${userId}, ${feature.caseId}, ${feature.key.slice(0, 40)}, ${feature.value.slice(0, 160)},
        ${feature.origin}, ${feature.evidence.slice(0, 40)}, ${feature.sourceUrl.slice(0, 500)}, true
      )
    `;
  }
}

function mapInsight(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    key: text(row.insight_key),
    version: Number(row.version ?? 1),
    title: text(row.title),
    kind: text(row.kind),
    priority: text(row.priority),
    confidence: text(row.confidence),
    status: text(row.status),
    reason: text(row.reason),
    alternative: text(row.alternative),
    disconfirmation: text(row.disconfirmation),
    chain: lines(text(row.chain)),
    sources: lines(text(row.sources)),
    caseIds: text(row.case_ids).split(",").map((item) => item.trim()).filter(Boolean),
    featureNote: text(row.feature_note),
    officialNote: text(row.official_note),
    dataClass: text(row.data_class),
    marks: text(row.marks),
    rarity: text(row.rarity),
    calculations: lines(text(row.calculations)),
    differences: lines(text(row.differences)),
    unknown: lines(text(row.unknown_note)),
    nextQuestions: lines(text(row.next_questions)),
    method: text(row.method),
    createdAt: iso(row.created_at),
  };
}

export async function listInsights(userId: string, caseId = "") {
  const db = await sql();
  const rows = await db<Record<string, unknown>>`
    select id, insight_key, version, title, kind, priority, confidence, status, reason, alternative, disconfirmation,
      chain, sources, case_ids, feature_note, official_note, data_class, marks, rarity, calculations, differences,
      unknown_note, next_questions, method, created_at
    from ci_insights where user_id = ${userId}
    order by created_at desc limit 80
  `;
  const mapped = rows.map(mapInsight).filter((row) => !caseId || row.caseIds.includes(caseId));
  const rank: Record<string, number> = { critical_review: 0, high: 1, medium: 2, low: 3 };
  const insights = mapped.filter((row) => row.status !== "superseded").sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  return {
    insights,
    history: mapped.filter((row) => row.status === "superseded").slice(0, 20),
  };
}

async function persistInsights(userId: string, fingerprint: string, insights: Awaited<ReturnType<typeof discover>>["insights"]) {
  const db = await sql();
  const current = await db<{
    id: string;
    insight_key: string;
    reason: string;
    priority: string;
    status: string;
    version: number;
    rarity: string;
    method: string;
    marks: string;
    calculations: string;
    differences: string;
    unknown_note: string;
    next_questions: string;
  }>`
    select id, insight_key, reason, priority, status, version, rarity, method, marks, calculations, differences, unknown_note, next_questions
    from ci_insights where user_id = ${userId} and status <> 'superseded'
  `;
  const byKey = new Map<string, {
    id: string;
    reason: string;
    priority: string;
    status: string;
    version: number;
    rarity: string;
    method: string;
    marks: string;
    calculations: string;
    differences: string;
    unknown: string;
    nextQuestions: string;
  }>();
  for (const row of current) {
    const version = Number(row.version ?? 1);
    const prev = byKey.get(row.insight_key);
    if (!prev || version > prev.version) {
      byKey.set(row.insight_key, {
        id: row.id,
        reason: row.reason,
        priority: row.priority,
        status: row.status,
        version,
        rarity: row.rarity ?? "",
        method: row.method ?? "",
        marks: row.marks ?? "",
        calculations: row.calculations ?? "",
        differences: row.differences ?? "",
        unknown: row.unknown_note ?? "",
        nextQuestions: row.next_questions ?? "",
      });
    }
  }
  let created = 0;
  const seen = new Set<string>();
  for (const insight of insights) {
    seen.add(insight.key);
    const latest = byKey.get(insight.key);
    const same = latest
      && latest.reason === insight.reason
      && latest.priority === insight.priority
      && latest.status === insight.status
      && latest.rarity === insight.rarity
      && latest.method === insight.method
      && latest.marks === insight.marks
      && latest.calculations === insight.calculations.join("\n").slice(0, 4000)
      && latest.differences === insight.differences.join("\n").slice(0, 2000)
      && latest.unknown === insight.unknown.join("\n").slice(0, 2000)
      && latest.nextQuestions === insight.nextQuestions.join("\n").slice(0, 2000);
    if (same) continue;
    if (latest) await db`update ci_insights set status = 'superseded' where user_id = ${userId} and insight_key = ${insight.key} and status <> 'superseded'`;
    await db`
      insert into ci_insights (
        id, user_id, insight_key, version, title, kind, priority, confidence, status, reason, alternative, disconfirmation,
        chain, sources, case_ids, feature_note, official_note, data_class, marks, rarity, calculations, differences,
        unknown_note, next_questions, method
      ) values (
        ${crypto.randomUUID()}, ${userId}, ${insight.key.slice(0, 400)}, ${(latest?.version ?? 0) + 1}, ${insight.title.slice(0, 180)},
        ${insight.kind}, ${insight.priority}, ${insight.confidence}, ${insight.status}, ${insight.reason.slice(0, 2000)},
        ${insight.alternative.slice(0, 1000)}, ${insight.disconfirmation.slice(0, 1000)}, ${insight.chain.join("\n").slice(0, 4000)},
        ${insight.sources.join("\n").slice(0, 2000)}, ${insight.caseIds.join(",")}, ${insight.featureNote.slice(0, 1000)}, ${insight.officialNote.slice(0, 2000)},
        ${insight.dataClass}, ${insight.marks.slice(0, 500)}, ${insight.rarity.slice(0, 1000)}, ${insight.calculations.join("\n").slice(0, 4000)},
        ${insight.differences.join("\n").slice(0, 2000)}, ${insight.unknown.join("\n").slice(0, 2000)}, ${insight.nextQuestions.join("\n").slice(0, 2000)},
        ${insight.method.slice(0, 80)}
      )
    `;
    created += 1;
  }
  for (const [key, row] of byKey) {
    if (seen.has(key)) continue;
    await db`update ci_insights set status = 'superseded' where id = ${row.id} and user_id = ${userId}`;
  }
  await db`
    insert into ci_discovery_state (user_id, fingerprint, updated_at)
    values (${userId}, ${fingerprint}, now())
    on conflict (user_id) do update set fingerprint = ${fingerprint}, updated_at = now()
  `;
  return created;
}

export async function listDerived(userId: string) {
  const db = await sql();
  const rows = await db<Record<string, unknown>>`
    select id, kind, value, method, inputs, case_ids, created_at
    from ci_derived where user_id = ${userId}
    order by created_at desc limit 40
  `;
  return rows.map((row) => ({
    id: text(row.id),
    kind: text(row.kind),
    value: text(row.value),
    method: text(row.method),
    inputs: text(row.inputs),
    caseIds: text(row.case_ids).split(",").map((item) => item.trim()).filter(Boolean),
    createdAt: iso(row.created_at),
  }));
}

async function persistDerived(userId: string, points: DerivedPoint[]) {
  const db = await sql();
  await db`delete from ci_derived where user_id = ${userId}`;
  for (const point of points.slice(0, 40)) {
    await db`
      insert into ci_derived (id, user_id, kind, value, method, inputs, case_ids)
      values (
        ${crypto.randomUUID()}, ${userId}, ${point.kind}, ${point.value.slice(0, 1000)}, ${point.method.slice(0, 80)},
        ${point.inputs.slice(0, 1000)}, ${point.caseIds.join(",")}
      )
    `;
  }
}

function deskNetwork(features: FeatureInput[]) {
  const seen = new Set<string>();
  const edges: { from: string; relation: string; to: string }[] = [];
  for (const edge of [...relationEdges(features), ...featureNetwork(features)]) {
    const id = `${edge.from}|${edge.relation}|${edge.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push(edge);
  }
  return edges.slice(0, 40);
}

export async function loadDiscoveryView(userId: string, caseId = "") {
  const features = await listFeatureRows(userId, caseId);
  const { insights, history } = await listInsights(userId, caseId);
  const derived = (await listDerived(userId)).filter((row) => !caseId || row.caseIds.includes(caseId));
  const networkFeatures = caseId ? await listFeatureRows(userId) : features;
  return {
    features: features.map((feature) => ({
      id: feature.id,
      caseId: feature.caseId,
      caseTitle: feature.caseTitle,
      key: feature.key,
      value: feature.value,
      origin: feature.origin,
      evidence: feature.evidence,
      sourceUrl: feature.sourceUrl,
      auto: Boolean(feature.auto),
    })),
    insights,
    history,
    derived,
    network: deskNetwork(networkFeatures),
  };
}

export async function compareStored(userId: string) {
  const seeds = await loadSeeds(userId);
  await replaceAutoFeatures(userId, seeds.flatMap((seed) => extractCaseFeatures(seed)));
  const features = await listFeatureRows(userId);
  const print = featureFingerprint(features);
  const db = await sql();
  const state = await db<{ fingerprint: string }>`select fingerprint from ci_discovery_state where user_id = ${userId} limit 1`;
  const network = deskNetwork(features);
  const listedNow = await listInsights(userId);
  const same = (state[0]?.fingerprint ?? "") === print;
  const stale = listedNow.insights.some((item) => !item.method);
  if (same && !stale) {
    const preview = discover(features);
    const byKey = new Map(listedNow.insights.map((item) => [item.key, item]));
    const drift = preview.insights.length !== listedNow.insights.length || preview.insights.some((insight) => {
      const row = byKey.get(insight.key);
      if (!row) return true;
      return row.priority !== insight.priority
        || row.status !== insight.status
        || row.reason !== insight.reason
        || row.rarity !== insight.rarity
        || row.marks !== insight.marks
        || row.method !== insight.method
        || row.calculations.join("\n") !== insight.calculations.join("\n").slice(0, 4000)
        || row.differences.join("\n") !== insight.differences.join("\n").slice(0, 2000)
        || row.unknown.join("\n") !== insight.unknown.join("\n").slice(0, 2000)
        || row.nextQuestions.join("\n") !== insight.nextQuestions.join("\n").slice(0, 2000);
    });
    if (!drift) {
      return { unchanged: true, created: 0, note: "Merkmale unverändert. Keine neue Bewertung.", network, derived: await listDerived(userId), ...listedNow };
    }
    const created = await persistInsights(userId, print, preview.insights);
    await persistDerived(userId, preview.derived);
    const listed = await listInsights(userId);
    return { unchanged: false, created, note: "Merkmale unverändert. Die Berechnung wurde einmal ergänzt.", network, derived: await listDerived(userId), ...listed };
  }
  const result = discover(features);
  const created = await persistInsights(userId, print, result.insights);
  await persistDerived(userId, result.derived);
  const listed = await listInsights(userId);
  const note = same ? "Merkmale unverändert. Die Berechnung wurde einmal ergänzt." : result.note;
  return { unchanged: false, created, note, network, derived: await listDerived(userId), ...listed };
}

