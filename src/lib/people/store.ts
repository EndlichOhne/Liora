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
  draftPerson,
  findMerge,
  linkCase,
  linkSource,
  missingNotes,
  relationForRole,
  reviewPerson,
  sameNameNotice,
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
  const merge = findMerge(userId, { userId, ...draft }, known);
  const sourceId = await rememberSource(userId, draft);
  if (merge) {
    await addPersonSource(userId, merge.id, sourceId, draft.sourceRelation, draft.evidence);
    return { id: merge.id, created: false as const, note: `Bereits vorhandene Person. ${merge.reason}. Nicht doppelt angelegt.` };
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
  const note = sameNameNotice(userId, { userId, displayName: draft.displayName }, known, false);
  return { id, created: true as const, note: note || "Zur Prüfung gespeichert. Nichts erfunden." };
}

export async function listPeople(userId: string, filter: { query?: string; role?: string; region?: string; status?: string }) {
  const db = await sql();
  const rows = await db<{
    id: string;
    display_name: string;
    normalized_name: string;
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
    select id, display_name, normalized_name, aliases, role, status, birth_year, nationality, region, summary,
      last_verified_at, created_at, updated_at
    from ci_persons where user_id = ${userId}
    order by updated_at desc limit 200
  `;
  const query = (filter.query ?? "").trim().toLowerCase();
  const people = rows
    .filter((row) => !filter.role || row.role === filter.role)
    .filter((row) => !filter.region || row.region === filter.region)
    .filter((row) => !filter.status || row.status === filter.status)
    .filter((row) => {
      if (!query) return true;
      return `${row.display_name} ${row.aliases} ${row.summary}`.toLowerCase().includes(query);
    })
    .map(personRow);
  const verified = rows
    .filter((row) => row.last_verified_at)
    .sort((left, right) => iso(right.last_verified_at).localeCompare(iso(left.last_verified_at)))
    .slice(0, 6)
    .map(personRow);
  const added = [...rows].sort((left, right) => iso(right.created_at).localeCompare(iso(left.created_at))).slice(0, 6).map(personRow);
  return { count: rows.length, people, verified, added };
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
  const [sources, cases, options] = await Promise.all([
    db<{
      id: string;
      source_id: string;
      relation: string;
      evidence_class: string;
      created_at: unknown;
      url: string;
      title: string;
      kind: string;
    }>`
      select ps.id, ps.source_id, ps.relation, ps.evidence_class, ps.created_at, s.url, s.title, s.kind
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
    }>`
      select pc.id, pc.case_id, pc.relation, pc.evidence_class, pc.source_id, pc.created_at, c.title, c.code
      from ci_person_cases pc
      join ci_cases c on c.id = pc.case_id and c.user_id = pc.user_id
      where pc.person_id = ${id} and pc.user_id = ${userId}
      order by pc.created_at
    `,
    db<{ id: string; title: string; code: string }>`
      select id, title, code from ci_cases where user_id = ${userId} order by updated_at desc limit 80
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
    createdAt: iso(item.created_at),
  }));
  const timeline = [
    ...sourceRows.map((source) => ({
      at: source.createdAt || "DATE MISSING",
      label: "Quelle",
      detail: source.title || source.url || "Ohne Titel",
      evidence: source.evidence,
    })),
    ...caseRows.map((item) => ({
      at: item.createdAt || "DATE MISSING",
      label: "Fall",
      detail: item.title,
      evidence: item.evidence,
    })),
    ...(person.lastVerifiedAt ? [{ at: person.lastVerifiedAt, label: "Prüfung", detail: "Quellen geprüft", evidence: "" }] : []),
  ];
  return {
    person,
    sources: sourceRows,
    cases: caseRows,
    documents: sourceRows.filter((source) => source.url),
    timeline,
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
  const cases = await db<{ id: string }>`select id from ci_cases where id = ${input.caseId} and user_id = ${userId} limit 1`;
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

export async function markPersonReviewed(userId: string, id: string) {
  const db = await sql();
  const people = await db<{ id: string }>`select id from ci_persons where id = ${id} and user_id = ${userId} limit 1`;
  if (!people[0]) throw new Error("Person nicht gefunden.");
  const sources = await db<{ evidence_class: string }>`
    select evidence_class from ci_person_sources where person_id = ${id} and user_id = ${userId}
  `;
  const reviewed = reviewPerson(
    userId,
    userId,
    sources.flatMap((source) => (isEvidence(source.evidence_class) ? [{ evidence: source.evidence_class, ownerId: userId }] : [])),
  );
  if (!reviewed.ok) throw new Error(reviewed.error);
  if (reviewed.status === "verified_public") {
    await db`
      update ci_persons set status = 'verified_public', last_verified_at = now(), updated_at = now()
      where id = ${id} and user_id = ${userId}
    `;
  }
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
      }
    }
  }
  await db`update ci_case_people set person_id = ${saved.id} where id = ${input.mentionId} and user_id = ${userId}`;
  return { linked: true as const, personId: saved.id, note: saved.note };
}
