import { getSql } from "@/lib/db";
import { addPerson } from "@/lib/cases/store";
import {
  classifyHost,
  contentHash,
  hostOf,
  isEvidence,
  type EvidenceClass,
  type PersonRole,
} from "@/lib/cases/engine";
import {
  LINK_NOTE,
  VERIFIED_MEANS,
  agreedValue,
  caseCountPhrase,
  conflictingClaims,
  decideVerification,
  draftPerson,
  duplicateScan,
  linkCase,
  linkSource,
  missingNotes,
  normalizeName,
  pageWindow,
  relationForRole,
  sameNameNotice,
  timelineEvent,
  type CaseRelation,
  type KnownPerson,
  type PeopleRole,
  type PersonDraft,
  type SourceRelation,
} from "@/lib/people/rules";

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

function yearOf(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}

function optional(value: unknown): string | null {
  const next = text(value).trim();
  return next || null;
}

async function sql() {
  return getSql();
}

async function rememberSource(userId: string, draft: Pick<PersonDraft, "sourceUrl" | "displayName" | "summary">) {
  const db = await sql();
  const existing = await db<{ id: string }>`select id from ci_sources where user_id = ${userId} and url = ${draft.sourceUrl} limit 1`;
  if (existing[0]) return existing[0].id;
  const host = classifyHost(draft.sourceUrl, draft.displayName);
  const reliability = host.evidence === "official" || host.evidence === "court" ? "high" : host.evidence === "documented" ? "medium" : "low";
  const id = crypto.randomUUID();
  await db`
    insert into ci_sources (id, user_id, url, title, kind, reliability, note, checked_at, content_hash, publisher, independence_status)
    values (
      ${id}, ${userId}, ${draft.sourceUrl.slice(0, 500)}, ${draft.displayName.slice(0, 180)}, ${host.kind}, ${reliability},
      ${draft.summary.slice(0, 500)}, now(), ${contentHash(draft.sourceUrl)}, ${hostOf(draft.sourceUrl).slice(0, 120)}, 'unknown'
    )
  `;
  return id;
}

async function knownPeople(userId: string): Promise<KnownPerson[]> {
  const db = await sql();
  const people = await db<{
    id: string;
    display_name: string;
    normalized_name: string;
    birth_year: unknown;
    nationality: string | null;
    region: string | null;
  }>`
    select id, display_name, normalized_name, birth_year, nationality, region
    from ci_persons where user_id = ${userId}
  `;
  const sources = await db<{ person_id: string; url: string }>`
    select ps.person_id, s.url
    from ci_person_sources ps
    join ci_sources s on s.id = ps.source_id and s.user_id = ps.user_id
    where ps.user_id = ${userId}
  `;
  const urls = new Map<string, string[]>();
  for (const source of sources) {
    const list = urls.get(source.person_id) ?? [];
    if (source.url) list.push(source.url);
    urls.set(source.person_id, list);
  }
  return people.map((row) => ({
    userId,
    id: row.id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    birthYear: yearOf(row.birth_year),
    nationality: optional(row.nationality),
    region: optional(row.region),
    sourceUrls: urls.get(row.id) ?? [],
  }));
}

async function addPersonSource(userId: string, personId: string, sourceId: string, relation: SourceRelation, evidence: EvidenceClass) {
  const db = await sql();
  const existing = await db<{ id: string }>`
    select id from ci_person_sources
    where user_id = ${userId} and person_id = ${personId} and source_id = ${sourceId} and relation = ${relation}
    limit 1
  `;
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  await db`
    insert into ci_person_sources (id, user_id, person_id, source_id, relation, evidence_class)
    values (${id}, ${userId}, ${personId}, ${sourceId}, ${relation}, ${evidence})
  `;
  return id;
}

async function addChange(userId: string, personId: string, action: string, note: string) {
  const db = await sql();
  await db`
    insert into ci_person_changes (id, user_id, person_id, action, note)
    values (${crypto.randomUUID()}, ${userId}, ${personId}, ${action.slice(0, 80)}, ${note.slice(0, 500)})
  `;
}

async function addTimeline(
  userId: string,
  personId: string,
  input: { label: string; detail: string; occurredOn: string; evidence: string; sourceId: string; caseId?: string },
) {
  const drafted = timelineEvent(input);
  if (!drafted.ok) return;
  const event = drafted.event;
  const db = await sql();
  await db`
    insert into ci_person_events (
      id, user_id, person_id, occurred_on, label, detail, evidence_class, source_id, case_id, confidence
    ) values (
      ${crypto.randomUUID()}, ${userId}, ${personId}, ${event.occurredOn}, ${event.label}, ${event.detail},
      ${event.evidence}, ${event.sourceId}, ${event.caseId}, ${event.confidence}
    )
  `;
}

async function addClaim(userId: string, personId: string, field: string, value: string, sourceId: string, evidence: EvidenceClass) {
  const db = await sql();
  const clean = value.trim().slice(0, 80);
  if (!clean || !sourceId) return;
  const present = await db<{ id: string }>`
    select id from ci_person_claims
    where user_id = ${userId} and person_id = ${personId} and field = ${field} and value = ${clean} and source_id = ${sourceId}
    limit 1
  `;
  if (!present[0]) {
    await db`
      insert into ci_person_claims (id, user_id, person_id, field, value, source_id, evidence_class)
      values (${crypto.randomUUID()}, ${userId}, ${personId}, ${field}, ${clean}, ${sourceId}, ${evidence})
    `;
  }
  const rows = await db<{ field: string; value: string; source_id: string }>`
    select field, value, source_id from ci_person_claims where user_id = ${userId} and person_id = ${personId}
  `;
  const claims = rows.map((row) => ({ field: row.field, value: row.value, sourceId: row.source_id }));
  const conflicts = conflictingClaims(claims);
  for (const conflict of conflicts) {
    const open = await db<{ id: string }>`
      select id from ci_person_conflicts
      where user_id = ${userId} and person_id = ${personId} and field = ${conflict.field}
        and left_value = ${conflict.left} and right_value = ${conflict.right}
      limit 1
    `;
    if (open[0]) continue;
    await db`
      insert into ci_person_conflicts (id, user_id, person_id, field, left_value, right_value, left_source_id, right_source_id, status)
      values (
        ${crypto.randomUUID()}, ${userId}, ${personId}, ${conflict.field}, ${conflict.left}, ${conflict.right},
        ${conflict.leftSourceId}, ${conflict.rightSourceId}, 'open'
      )
    `;
  }
  if (field !== "birth_year") return;
  const mine = claims.filter((claim) => claim.field === "birth_year");
  if (conflicts.some((conflict) => conflict.field === "birth_year")) {
    await db`
      update ci_persons set birth_year = null, status = 'conflicting', updated_at = now()
      where id = ${personId} and user_id = ${userId}
    `;
    return;
  }
  const agreed = agreedValue(mine);
  if (agreed && /^\d{4}$/.test(agreed)) {
    await db`
      update ci_persons set birth_year = ${Number(agreed)}, updated_at = now()
      where id = ${personId} and user_id = ${userId} and status <> 'conflicting'
    `;
  }
}

async function addDuplicate(userId: string, personId: string, otherId: string, reason: string) {
  if (!otherId || personId === otherId) return;
  const db = await sql();
  const present = await db<{ id: string }>`
    select id from ci_person_duplicates
    where user_id = ${userId}
      and ((person_id = ${personId} and other_id = ${otherId}) or (person_id = ${otherId} and other_id = ${personId}))
    limit 1
  `;
  if (present[0]) return;
  await db`
    insert into ci_person_duplicates (id, user_id, person_id, other_id, reason, status)
    values (${crypto.randomUUID()}, ${userId}, ${personId}, ${otherId}, ${reason.slice(0, 240)}, 'needs_review')
  `;
}

export async function noteSourceMentions(userId: string, sourceId: string, text: string, skipPersonId = "") {
  const hay = ` ${normalizeName(text)} `;
  if (hay.trim().length < 5 || !sourceId) return;
  const known = await knownPeople(userId);
  const db = await sql();
  for (const person of known) {
    if (person.id === skipPersonId) continue;
    const name = person.normalizedName;
    if (name.length < 5 || !name.includes(" ")) continue;
    if (!hay.includes(` ${name} `)) continue;
    const present = await db<{ id: string }>`
      select id from ci_person_hints
      where user_id = ${userId} and person_id = ${person.id} and source_id = ${sourceId}
      limit 1
    `;
    if (present[0]) continue;
    await db`
      insert into ci_person_hints (id, user_id, person_id, source_id, note, status)
      values (
        ${crypto.randomUUID()}, ${userId}, ${person.id}, ${sourceId},
        'Name in der Quelle erkannt. Keine Tatsache. Zur Prüfung.', 'needs_review'
      )
    `;
  }
}

export async function createPerson(
  userId: string,
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
  },
) {
  const drafted = draftPerson({ ...input, origin: "public_source" });
  if (!drafted.ok) throw new Error(drafted.error);
  const draft = drafted.draft;
  const known = await knownPeople(userId);
  const scan = duplicateScan(userId, { userId, ...draft }, known);
  const sourceId = await rememberSource(userId, draft);
  if (scan.kind === "merge") {
    await addPersonSource(userId, scan.id, sourceId, draft.sourceRelation, draft.evidence);
    await addChange(userId, scan.id, "quelle", "Weitere Quelle zur vorhandenen Person.");
    await addTimeline(userId, scan.id, { label: "Öffentliche Quelle", detail: draft.summary || draft.displayName, occurredOn: "", evidence: draft.evidence, sourceId, caseId: "" });
    if (draft.birthYear != null) await addClaim(userId, scan.id, "birth_year", String(draft.birthYear), sourceId, draft.evidence);
    await noteSourceMentions(userId, sourceId, `${draft.displayName} ${draft.summary}`, scan.id);
    return { id: scan.id, created: false as const, note: `Bereits vorhandene Person. ${scan.reason}. Nicht doppelt angelegt.` };
  }
  const db = await sql();
  const id = crypto.randomUUID();
  await db`
    insert into ci_persons (
      id, user_id, display_name, normalized_name, aliases, role, status, birth_year, nationality, region, summary
    ) values (
      ${id}, ${userId}, ${draft.displayName}, ${draft.normalizedName}, ${draft.aliases.join("\n")}, ${draft.role},
      ${draft.status}, ${draft.birthYear}, ${draft.nationality}, ${draft.region}, ${draft.summary}
    )
  `;
  await addPersonSource(userId, id, sourceId, draft.sourceRelation, draft.evidence);
  await addChange(userId, id, "angelegt", "Zur Prüfung gespeichert.");
  await addTimeline(userId, id, { label: "Öffentliche Quelle", detail: draft.summary || draft.displayName, occurredOn: "", evidence: draft.evidence, sourceId, caseId: "" });
  if (draft.birthYear != null) await addClaim(userId, id, "birth_year", String(draft.birthYear), sourceId, draft.evidence);
  if (scan.kind === "possible") await addDuplicate(userId, id, scan.id, scan.reason);
  await noteSourceMentions(userId, sourceId, `${draft.displayName} ${draft.summary}`, id);
  const note = scan.kind === "possible" ? scan.reason : sameNameNotice(userId, { userId, displayName: draft.displayName }, known, false);
  return { id, created: true as const, note: note || "Zur Prüfung gespeichert. Nichts erfunden." };
}

export async function listPeople(userId: string, filter: { query?: string; role?: string; region?: string; status?: string; filter?: string; page?: number }) {
  const db = await sql();
  const window = pageWindow(filter.page ?? 1);
  const query = (filter.query ?? "").replace(/[%_]/g, "").trim();
  const needle = query ? `%${query.toLowerCase()}%` : "";
  const choice = filter.filter || "";
  const role = filter.role || (choice === "wanted_public" || choice === "historical" || choice === "missing" ? choice : "");
  const status = filter.status || (choice === "needs_review" || choice === "partially_verified" || choice === "verified_public" || choice === "outdated" || choice === "conflicting" ? choice : "");
  const court = choice === "court";
  const region = filter.region || "";
  const rows = await db<{
    id: string;
    display_name: string;
    aliases: string;
    role: string;
    status: string;
    birth_year: unknown;
    nationality: string | null;
    region: string | null;
    summary: string;
    last_verified_at: unknown;
    created_at: unknown;
    updated_at: unknown;
    case_count: number;
  }>`
    select p.id, p.display_name, p.aliases, p.role, p.status, p.birth_year, p.nationality, p.region, p.summary,
      p.last_verified_at, p.created_at, p.updated_at,
      (select count(*)::int from ci_person_cases pc where pc.person_id = p.id and pc.user_id = p.user_id) as case_count
    from ci_persons p
    where p.user_id = ${userId}
      and (${needle} = '' or lower(p.display_name) like ${needle} or lower(p.aliases) like ${needle} or p.normalized_name like ${needle})
      and (${role} = '' or p.role = ${role})
      and (${status} = '' or p.status = ${status})
      and (${region} = '' or p.region = ${region})
      and (${court} = false or exists (
        select 1 from ci_person_cases c where c.user_id = p.user_id and c.person_id = p.id and c.evidence_class = 'court'
      ) or exists (
        select 1 from ci_person_sources s where s.user_id = p.user_id and s.person_id = p.id and s.evidence_class = 'court'
      ))
    order by p.updated_at desc
    limit ${window.limit} offset ${window.offset}
  `;
  const totals = await db<{ count: number }>`
    select count(*)::int as count from ci_persons p
    where p.user_id = ${userId}
      and (${needle} = '' or lower(p.display_name) like ${needle} or lower(p.aliases) like ${needle} or p.normalized_name like ${needle})
      and (${role} = '' or p.role = ${role})
      and (${status} = '' or p.status = ${status})
      and (${region} = '' or p.region = ${region})
      and (${court} = false or exists (
        select 1 from ci_person_cases c where c.user_id = p.user_id and c.person_id = p.id and c.evidence_class = 'court'
      ) or exists (
        select 1 from ci_person_sources s where s.user_id = p.user_id and s.person_id = p.id and s.evidence_class = 'court'
      ))
  `;
  const verified = await db<typeof rows[number]>`
    select id, display_name, aliases, role, status, birth_year, nationality, region, summary,
      last_verified_at, created_at, updated_at, 0::int as case_count
    from ci_persons where user_id = ${userId} and last_verified_at is not null
    order by last_verified_at desc limit 6
  `;
  const added = await db<typeof rows[number]>`
    select id, display_name, aliases, role, status, birth_year, nationality, region, summary,
      last_verified_at, created_at, updated_at, 0::int as case_count
    from ci_persons where user_id = ${userId}
    order by created_at desc limit 6
  `;
  const count = totals[0]?.count ?? 0;
  return {
    count,
    page: window.page,
    pages: Math.max(1, Math.ceil(count / window.limit)),
    people: rows.map(personRow),
    verified: verified.map(personRow),
    added: added.map(personRow),
  };
}

function personRow(row: {
  id: string;
  display_name: string;
  aliases: string;
  role: string;
  status: string;
  birth_year: unknown;
  nationality: string | null;
  region: string | null;
  summary: string;
  last_verified_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  case_count?: number;
}) {
  const birthYear = yearOf(row.birth_year);
  const nationality = optional(row.nationality);
  const region = optional(row.region);
  return {
    id: row.id,
    displayName: row.display_name,
    aliases: row.aliases.split("\n").map((item) => item.trim()).filter(Boolean),
    role: row.role,
    status: row.status,
    birthYear,
    nationality,
    region,
    summary: row.summary,
    missing: missingNotes({ birthYear, nationality, region }),
    caseCount: Number(row.case_count ?? 0),
    lastVerifiedAt: row.last_verified_at ? iso(row.last_verified_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function getPersonFile(userId: string, id: string) {
  const db = await sql();
  const people = await db<{
    id: string;
    display_name: string;
    aliases: string;
    role: string;
    status: string;
    birth_year: unknown;
    nationality: string | null;
    region: string | null;
    summary: string;
    last_verified_at: unknown;
    created_at: unknown;
    updated_at: unknown;
  }>`
    select id, display_name, aliases, role, status, birth_year, nationality, region, summary, last_verified_at, created_at, updated_at
    from ci_persons where id = ${id} and user_id = ${userId} limit 1
  `;
  const row = people[0];
  if (!row) return null;
  const [sources, cases, options, events, conflicts, duplicates, changes, hints, claims] = await Promise.all([
    db<{
      id: string;
      source_id: string;
      relation: string;
      evidence_class: string;
      created_at: unknown;
      url: string;
      title: string;
      kind: string;
      publisher: string;
      published_at: string;
      checked_at: unknown;
      independence_status: string;
    }>`
      select ps.id, ps.source_id, ps.relation, ps.evidence_class, ps.created_at,
        s.url, s.title, s.kind, s.publisher, s.published_at, s.checked_at, s.independence_status
      from ci_person_sources ps
      join ci_sources s on s.id = ps.source_id and s.user_id = ps.user_id
      where ps.person_id = ${id} and ps.user_id = ${userId}
      order by ps.created_at
    `,
    db<{
      id: string;
      case_id: string;
      relation: string;
      evidence_class: string;
      source_id: string;
      created_at: unknown;
      title: string;
      code: string;
      city: string;
      place: string;
      opened_on: string;
      case_type: string;
      updated_at: unknown;
      source_url: string;
      checked_at: unknown;
    }>`
      select pc.id, pc.case_id, pc.relation, pc.evidence_class, pc.source_id, pc.created_at,
        c.title, c.code, c.city, c.place, c.opened_on, c.case_type, c.updated_at,
        coalesce(s.url, '') as source_url, s.checked_at
      from ci_person_cases pc
      join ci_cases c on c.id = pc.case_id and c.user_id = pc.user_id
      left join ci_sources s on s.id = pc.source_id and s.user_id = pc.user_id
      where pc.person_id = ${id} and pc.user_id = ${userId}
      order by pc.created_at
    `,
    db<{ id: string; title: string; code: string }>`
      select id, title, code from ci_cases where user_id = ${userId} order by updated_at desc limit 80
    `,
    db<{
      id: string;
      occurred_on: string;
      label: string;
      detail: string;
      evidence_class: string;
      source_id: string;
      case_id: string;
      confidence: string;
      created_at: unknown;
      updated_at: unknown;
    }>`
      select id, occurred_on, label, detail, evidence_class, source_id, case_id, confidence, created_at, updated_at
      from ci_person_events where person_id = ${id} and user_id = ${userId}
      order by occurred_on, created_at
    `,
    db<{
      id: string;
      field: string;
      left_value: string;
      right_value: string;
      left_source_id: string;
      right_source_id: string;
      status: string;
    }>`
      select id, field, left_value, right_value, left_source_id, right_source_id, status
      from ci_person_conflicts where person_id = ${id} and user_id = ${userId}
      order by created_at
    `,
    db<{ id: string; other_id: string; reason: string; status: string; display_name: string }>`
      select d.id, d.other_id, d.reason, d.status, p.display_name
      from ci_person_duplicates d
      join ci_persons p on p.id = d.other_id and p.user_id = d.user_id
      where d.person_id = ${id} and d.user_id = ${userId}
      order by d.created_at
    `,
    db<{ id: string; action: string; note: string; created_at: unknown }>`
      select id, action, note, created_at from ci_person_changes
      where person_id = ${id} and user_id = ${userId}
      order by created_at desc
      limit 40
    `,
    db<{ id: string; source_id: string; note: string; status: string; title: string; url: string }>`
      select h.id, h.source_id, h.note, h.status, s.title, s.url
      from ci_person_hints h
      join ci_sources s on s.id = h.source_id and s.user_id = h.user_id
      where h.person_id = ${id} and h.user_id = ${userId}
      order by h.created_at
    `,
    db<{ id: string; field: string; value: string; source_id: string; evidence_class: string }>`
      select id, field, value, source_id, evidence_class from ci_person_claims
      where person_id = ${id} and user_id = ${userId}
      order by created_at
    `,
  ]);
  const person = personRow(row);
  const sourceRows = sources.map((source) => ({
    id: source.id,
    sourceId: source.source_id,
    relation: source.relation,
    evidence: source.evidence_class,
    url: source.url,
    title: source.title,
    kind: source.kind,
    publisher: source.publisher || "",
    publishedAt: source.published_at || "",
    checkedAt: source.checked_at ? iso(source.checked_at) : "",
    independence: source.independence_status || "unknown",
    createdAt: iso(source.created_at),
  }));
  const caseRows = cases.map((item) => ({
    id: item.id,
    caseId: item.case_id,
    relation: item.relation,
    evidence: item.evidence_class,
    sourceId: item.source_id,
    title: item.title,
    code: item.code,
    city: item.city || "",
    place: item.place || "",
    openedOn: item.opened_on || "",
    caseType: item.case_type || "",
    updatedAt: iso(item.updated_at),
    sourceUrl: item.source_url || "",
    checkedAt: item.checked_at ? iso(item.checked_at) : "",
    createdAt: iso(item.created_at),
  }));
  person.caseCount = caseRows.length;
  const timeline = events.map((event) => ({
    id: event.id,
    at: event.occurred_on || "DATE MISSING",
    label: event.label,
    detail: event.detail,
    evidence: event.evidence_class,
    sourceId: event.source_id,
    caseId: event.case_id || "",
    confidence: event.confidence,
    createdAt: iso(event.created_at),
    updatedAt: iso(event.updated_at),
  }));
  return {
    person,
    sources: sourceRows,
    cases: caseRows,
    casePhrase: caseCountPhrase(caseRows.length),
    documents: sourceRows.filter((source) => source.url),
    timeline,
    links: [
      ...caseRows.map((item) => ({ kind: "case" as const, id: item.caseId, label: item.title, relation: item.relation, evidence: item.evidence })),
      ...sourceRows.map((source) => ({ kind: "source" as const, id: source.sourceId, label: source.title || source.url, relation: source.relation, evidence: source.evidence })),
      ...timeline.map((event) => ({ kind: "event" as const, id: event.id, label: event.label, relation: event.caseId ? "case" : "source", evidence: event.evidence })),
    ],
    linkNote: LINK_NOTE,
    verifiedMeans: VERIFIED_MEANS,
    conflicts: conflicts.map((item) => ({
      id: item.id,
      field: item.field,
      left: item.left_value,
      right: item.right_value,
      leftSourceId: item.left_source_id,
      rightSourceId: item.right_source_id,
      status: item.status,
    })),
    duplicates: duplicates.map((item) => ({
      id: item.id,
      otherId: item.other_id,
      name: item.display_name,
      reason: item.reason,
      status: item.status,
    })),
    changes: changes.map((item) => ({
      id: item.id,
      action: item.action,
      note: item.note,
      createdAt: iso(item.created_at),
    })),
    hints: hints.map((item) => ({
      id: item.id,
      sourceId: item.source_id,
      note: item.note,
      status: item.status,
      title: item.title,
      url: item.url,
    })),
    claims: claims.map((item) => ({
      id: item.id,
      field: item.field,
      value: item.value,
      sourceId: item.source_id,
      evidence: item.evidence_class,
    })),
    caseOptions: options.map((item) => ({ id: item.id, title: item.title, code: item.code })),
  };
}

async function ownedSource(userId: string, sourceId: string) {
  const db = await sql();
  const rows = await db<{ id: string; url: string }>`select id, url from ci_sources where id = ${sourceId} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function attachPersonSource(
  userId: string,
  input: { personId: string; sourceUrl: string; relation: string; evidence: string; title: string },
) {
  const db = await sql();
  const people = await db<{ id: string }>`select id from ci_persons where id = ${input.personId} and user_id = ${userId} limit 1`;
  if (!people[0]) throw new Error("Person nicht gefunden.");
  const drafted = draftPerson({
    displayName: input.title.trim() || input.sourceUrl,
    aliases: [],
    role: "publicly_named",
    birthYear: null,
    nationality: null,
    region: null,
    summary: "",
    sourceUrl: input.sourceUrl,
    evidence: input.evidence,
    sourceRelation: input.relation,
    origin: "public_source",
  });
  if (!drafted.ok) throw new Error(drafted.error);
  const sourceId = await rememberSource(userId, { sourceUrl: drafted.draft.sourceUrl, displayName: drafted.draft.displayName, summary: "" });
  const linked = linkSource({
    actorId: userId,
    personOwnerId: userId,
    sourceOwnerId: userId,
    sourceId,
    relation: drafted.draft.sourceRelation,
    evidence: drafted.draft.evidence,
  });
  if (!linked.ok) throw new Error(linked.error);
  await addPersonSource(userId, input.personId, sourceId, linked.relation, linked.evidence);
  await addTimeline(userId, input.personId, {
    label: "Öffentliche Quelle",
    detail: drafted.draft.displayName,
    occurredOn: "",
    evidence: linked.evidence,
    sourceId,
    caseId: "",
  });
  await addChange(userId, input.personId, "quelle", "Quelle zugeordnet.");
  await noteSourceMentions(userId, sourceId, `${input.title} ${drafted.draft.displayName}`, input.personId);
  await db`update ci_persons set updated_at = now() where id = ${input.personId} and user_id = ${userId}`;
  return { ok: true as const };
}

export async function attachPersonCase(
  userId: string,
  input: { personId: string; caseId: string; relation: string; evidence: string; sourceId: string },
) {
  const db = await sql();
  const people = await db<{ id: string; display_name: string; summary: string }>`
    select id, display_name, summary from ci_persons where id = ${input.personId} and user_id = ${userId} limit 1
  `;
  const cases = await db<{ id: string; title: string; opened_on: string }>`
    select id, title, opened_on from ci_cases where id = ${input.caseId} and user_id = ${userId} limit 1
  `;
  const source = await ownedSource(userId, input.sourceId);
  if (!people[0] || !cases[0] || !source) throw new Error("Person, Fall oder Quelle nicht gefunden.");
  const linked = linkCase({
    actorId: userId,
    personOwnerId: userId,
    caseOwnerId: userId,
    sourceOwnerId: userId,
    sourceId: source.id,
    relation: input.relation,
    evidence: input.evidence,
  });
  if (!linked.ok) throw new Error(linked.error);
  const existing = await db<{ id: string }>`
    select id from ci_person_cases
    where user_id = ${userId} and person_id = ${input.personId} and case_id = ${input.caseId}
      and relation = ${linked.relation} and source_id = ${source.id}
    limit 1
  `;
  if (!existing[0]) {
    const mention = await addPerson(userId, {
      caseId: input.caseId,
      name: people[0].display_name,
      role: mentionRoleFor(linked.relation),
      evidence: linked.evidence,
      note: people[0].summary,
      sourceUrl: source.url,
    });
    await db`
      insert into ci_person_cases (id, user_id, person_id, case_id, relation, evidence_class, source_id)
      values (${crypto.randomUUID()}, ${userId}, ${input.personId}, ${input.caseId}, ${linked.relation}, ${linked.evidence}, ${source.id})
    `;
    await db`update ci_case_people set person_id = ${input.personId} where id = ${mention.id} and user_id = ${userId}`;
    await addTimeline(userId, input.personId, {
      label: "Fall",
      detail: cases[0].title,
      occurredOn: cases[0].opened_on || "",
      evidence: linked.evidence,
      sourceId: source.id,
      caseId: input.caseId,
    });
    await addChange(userId, input.personId, "fall", "Fallbeziehung mit Quelle gespeichert.");
  }
  await db`update ci_persons set updated_at = now() where id = ${input.personId} and user_id = ${userId}`;
  return { ok: true as const };
}

function mentionRoleFor(relation: CaseRelation): PersonRole {
  if (relation === "convicted_in") return "convicted";
  if (relation === "missing_from") return "missing";
  if (relation === "witness_in") return "witness_public";
  if (relation === "authority_in") return "authority";
  return "named";
}

export async function markPersonReviewed(userId: string, id: string, outdated = false) {
  const db = await sql();
  const people = await db<{ id: string }>`select id from ci_persons where id = ${id} and user_id = ${userId} limit 1`;
  if (!people[0]) throw new Error("Person nicht gefunden.");
  const sources = await db<{ evidence_class: string; source_id: string }>`
    select evidence_class, source_id from ci_person_sources where person_id = ${id} and user_id = ${userId}
  `;
  const conflicts = await db<{ count: number }>`
    select count(*)::int as count from ci_person_conflicts
    where person_id = ${id} and user_id = ${userId} and status = 'open'
  `;
  const reviewed = decideVerification({
    actorId: userId,
    personOwnerId: userId,
    sources: sources.flatMap((source) => (isEvidence(source.evidence_class) ? [{ evidence: source.evidence_class, ownerId: userId }] : [])),
    conflicts: conflicts[0]?.count ?? 0,
    outdated,
  });
  if (!reviewed.ok) throw new Error(reviewed.error);
  await db`
    update ci_persons set status = ${reviewed.status}, last_verified_at = now(), updated_at = now()
    where id = ${id} and user_id = ${userId}
  `;
  const sourceId = sources[0]?.source_id ?? "";
  if (sourceId) {
    const today = new Date().toISOString().slice(0, 10);
    await addTimeline(userId, id, {
      label: "Letzte Verifizierung",
      detail: reviewed.note,
      occurredOn: today,
      evidence: isEvidence(sources[0].evidence_class) ? sources[0].evidence_class : "documented",
      sourceId,
      caseId: "",
    });
  }
  await addChange(userId, id, "prüfung", reviewed.note);
  return { status: reviewed.status, note: reviewed.note };
}

const FROM_CASE: Record<PersonRole, PeopleRole> = {
  named: "publicly_named",
  missing: "missing",
  convicted: "convicted",
  authority: "authority",
  witness_public: "witness_public",
};

export async function fileFromCaseMention(
  userId: string,
  input: { mentionId: string; caseId: string; name: string; role: PersonRole; evidence: EvidenceClass; note: string; sourceUrl: string },
) {
  const drafted = draftPerson({
    displayName: input.name,
    aliases: [],
    role: FROM_CASE[input.role],
    birthYear: null,
    nationality: null,
    region: null,
    summary: input.note,
    sourceUrl: input.sourceUrl,
    evidence: input.evidence,
    sourceRelation: "identifies",
    origin: "public_source",
  });
  if (!drafted.ok) return { linked: false as const, personId: null, note: drafted.error };
  const saved = await createPerson(userId, {
    displayName: drafted.draft.displayName,
    aliases: drafted.draft.aliases,
    role: drafted.draft.role,
    birthYear: null,
    nationality: null,
    region: null,
    summary: drafted.draft.summary,
    sourceUrl: drafted.draft.sourceUrl,
    evidence: drafted.draft.evidence,
    sourceRelation: "identifies",
  });
  const db = await sql();
  const ownedCase = await db<{ id: string }>`select id from ci_cases where id = ${input.caseId} and user_id = ${userId} limit 1`;
  const source = ownedCase[0]
    ? await db<{ id: string }>`select id from ci_sources where user_id = ${userId} and url = ${drafted.draft.sourceUrl} limit 1`
    : [];
  if (ownedCase[0] && source[0]) {
    const relation = relationForRole(drafted.draft.role);
    const linked = linkCase({
      actorId: userId,
      personOwnerId: userId,
      caseOwnerId: userId,
      sourceOwnerId: userId,
      sourceId: source[0].id,
      relation,
      evidence: drafted.draft.evidence,
    });
    if (linked.ok) {
      const present = await db<{ id: string }>`
        select id from ci_person_cases
        where user_id = ${userId} and person_id = ${saved.id} and case_id = ${input.caseId} and relation = ${linked.relation}
        limit 1
      `;
      if (!present[0]) {
        await db`
          insert into ci_person_cases (id, user_id, person_id, case_id, relation, evidence_class, source_id)
          values (${crypto.randomUUID()}, ${userId}, ${saved.id}, ${input.caseId}, ${linked.relation}, ${linked.evidence}, ${source[0].id})
        `;
        const opened = await db<{ title: string; opened_on: string }>`
          select title, opened_on from ci_cases where id = ${input.caseId} and user_id = ${userId} limit 1
        `;
        await addTimeline(userId, saved.id, {
          label: "Fall",
          detail: opened[0]?.title || input.caseId,
          occurredOn: opened[0]?.opened_on || "",
          evidence: linked.evidence,
          sourceId: source[0].id,
          caseId: input.caseId,
        });
        await addChange(userId, saved.id, "fall", "Fall aus der öffentlichen Erwähnung zugeordnet.");
      }
    }
  }
  await db`update ci_case_people set person_id = ${saved.id} where id = ${input.mentionId} and user_id = ${userId}`;
  return { linked: true as const, personId: saved.id, note: saved.note };
}

export async function listSourceNetwork(userId: string) {
  const db = await sql();
  const people = await db<{ source_id: string; person_id: string; display_name: string }>`
    select ps.source_id, p.id as person_id, p.display_name
    from ci_person_sources ps
    join ci_persons p on p.id = ps.person_id and p.user_id = ps.user_id
    where ps.user_id = ${userId}
  `;
  const cases = await db<{ source_id: string; case_id: string; title: string; code: string }>`
    select s.id as source_id, c.id as case_id, c.title, c.code
    from ci_sources s
    join ci_cases c on c.id = s.case_id and c.user_id = s.user_id
    where s.user_id = ${userId} and s.case_id is not null
    union
    select pc.source_id, c.id as case_id, c.title, c.code
    from ci_person_cases pc
    join ci_cases c on c.id = pc.case_id and c.user_id = pc.user_id
    where pc.user_id = ${userId}
  `;
  const bySource: Record<string, { people: { id: string; name: string }[]; cases: { id: string; title: string }[] }> = {};
  for (const row of people) {
    const slot = bySource[row.source_id] ?? { people: [], cases: [] };
    if (!slot.people.some((item) => item.id === row.person_id)) slot.people.push({ id: row.person_id, name: row.display_name });
    bySource[row.source_id] = slot;
  }
  for (const row of cases) {
    const slot = bySource[row.source_id] ?? { people: [], cases: [] };
    if (!slot.cases.some((item) => item.id === row.case_id)) slot.cases.push({ id: row.case_id, title: row.code ? `${row.code} · ${row.title}` : row.title });
    bySource[row.source_id] = slot;
  }
  return bySource;
}
