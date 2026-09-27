import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getSql, type Sql } from "@/lib/db";
import type {
  AttachmentRef,
  Citation,
  ConversationDTO,
  FileDTO,
  MemoryCategory,
  MemoryDTO,
  MessageDTO,
  Mode,
  NoteDTO,
  ProfileDTO,
  ProjectDTO,
  ResponseStyle,
  TaskDTO,
  ThemeChoice,
} from "@/lib/domain";
import { isMemoryCategory, isMemoryConfidence, isMode } from "@/lib/domain";
import { extractUpload, normalizeMime, safeName } from "@/lib/files.server";

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(String(value)).toISOString();
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function assertId(id: string) {
  if (!/^[0-9a-f-]{16,80}$/i.test(id)) throw new Error("Ungültige ID.");
}

async function db(): Promise<Sql> {
  return getSql();
}

type UserRow = { name: string; email: string };

async function userRow(sql: Sql, userId: string): Promise<UserRow | null> {
  const rows = await sql<UserRow>`select "name", "email" from "user" where "id" = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function ensureProfile(userId: string): Promise<ProfileDTO> {
  const sql = await db();
  const user = await userRow(sql, userId);
  await sql`
    insert into profiles (user_id, display_name)
    values (${userId}, ${user?.name ?? ""})
    on conflict (user_id) do nothing
  `;
  return readProfile(userId);
}

function mapProfile(
  row: {
    display_name: string;
    language: string;
    writing_notes: string;
    response_style: string;
    theme: string;
    model_id: string;
    voice_id: string;
    voice_auto: boolean;
  },
  email: string | null,
  hasPassword: boolean,
): ProfileDTO {
  const language = row.language === "en" ? "en" : "de";
  const responseStyle: ResponseStyle =
    row.response_style === "concise" || row.response_style === "thorough" ? row.response_style : "balanced";
  const theme: ThemeChoice = row.theme === "light" || row.theme === "dark" ? row.theme : "system";
  return {
    displayName: row.display_name ?? "",
    language,
    writingNotes: row.writing_notes ?? "",
    responseStyle,
    theme,
    modelId: row.model_id || "grok-4.5",
    voiceId: row.voice_id || "eve",
    voiceAuto: Boolean(row.voice_auto),
    email,
    hasPassword,
  };
}

export async function readProfile(userId: string): Promise<ProfileDTO> {
  const sql = await db();
  const rows = await sql<{
    display_name: string;
    language: string;
    writing_notes: string;
    response_style: string;
    theme: string;
    model_id: string;
    voice_id: string;
    voice_auto: boolean;
  }>`select display_name, language, writing_notes, response_style, theme, model_id, voice_id, voice_auto
     from profiles where user_id = ${userId} limit 1`;
  const row = rows[0];
  if (!row) return ensureProfile(userId);
  const user = await userRow(sql, userId);
  const pw = await sql<{ n: number }>`
    select count(*) as n from "account"
    where "userId" = ${userId} and "providerId" = 'credential' and "password" is not null
  `;
  return mapProfile(row, user?.email ?? null, Number(pw[0]?.n ?? 0) > 0);
}

export async function updateProfile(
  userId: string,
  patch: Partial<{
    displayName: string;
    language: "de" | "en";
    writingNotes: string;
    responseStyle: ResponseStyle;
    theme: ThemeChoice;
    modelId: string;
    voiceId: string;
    voiceAuto: boolean;
  }>,
): Promise<ProfileDTO> {
  await ensureProfile(userId);
  const sql = await db();
  const current = await readProfile(userId);
  const next = {
    displayName: (patch.displayName ?? current.displayName).trim().slice(0, 80),
    language: patch.language === "en" || patch.language === "de" ? patch.language : current.language,
    writingNotes: (patch.writingNotes ?? current.writingNotes).slice(0, 2000),
    responseStyle: patch.responseStyle ?? current.responseStyle,
    theme: patch.theme ?? current.theme,
    modelId: (patch.modelId ?? current.modelId).trim(),
    voiceId: (patch.voiceId ?? current.voiceId).trim().slice(0, 32) || "eve",
    voiceAuto: patch.voiceAuto ?? current.voiceAuto,
  };
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(next.modelId)) throw new Error("Ungültige Modell-ID.");
  if (!["eve", "ara", "rex", "sal"].includes(next.voiceId) && !/^[a-z0-9_-]{1,32}$/i.test(next.voiceId)) {
    throw new Error("Ungültige Stimme.");
  }
  await sql`
    update profiles set
      display_name = ${next.displayName},
      language = ${next.language},
      writing_notes = ${next.writingNotes},
      response_style = ${next.responseStyle},
      theme = ${next.theme},
      model_id = ${next.modelId},
      voice_id = ${next.voiceId},
      voice_auto = ${next.voiceAuto},
      updated_at = now()
    where user_id = ${userId}
  `;
  if (next.displayName) {
    await sql`update "user" set "name" = ${next.displayName}, "updatedAt" = now() where "id" = ${userId}`;
  }
  return readProfile(userId);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = "";
  for (const b of bytes) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return raw;
}

function formatCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function issueRecoveryCode(userId: string): Promise<string | null> {
  const sql = await db();
  const existing = await sql<{ user_id: string }>`select user_id from recovery_codes where user_id = ${userId} limit 1`;
  if (existing.length) return null;
  const raw = randomCode();
  const codeHash = await hashPassword(raw);
  await sql`insert into recovery_codes (user_id, code_hash) values (${userId}, ${codeHash})`;
  return formatCode(raw);
}

export async function rotateRecoveryCode(userId: string): Promise<string> {
  await assertRate(userId, "recovery", 5, "1 day");
  const sql = await db();
  const raw = randomCode();
  const codeHash = await hashPassword(raw);
  await sql`
    insert into recovery_codes (user_id, code_hash) values (${userId}, ${codeHash})
    on conflict (user_id) do update set code_hash = ${codeHash}, created_at = now()
  `;
  await recordUsage(userId, "recovery");
  return formatCode(raw);
}

export async function resetWithRecovery(email: string, code: string, newPassword: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Bitte eine gültige E-Mail angeben.");
  if (newPassword.length < 10 || newPassword.length > 200) {
    throw new Error("Das neue Passwort braucht mindestens 10 Zeichen.");
  }
  await assertRate(normalizedEmail, "reset", 8, "1 hour");
  await recordUsage(normalizedEmail, "reset");
  const sql = await db();
  const users = await sql<{ id: string }>`select "id" from "user" where lower("email") = ${normalizedEmail} limit 1`;
  const user = users[0];
  const codes = user
    ? await sql<{ code_hash: string }>`select code_hash from recovery_codes where user_id = ${user.id} limit 1`
    : [];
  const ok =
    user && codes[0] ? await verifyPassword({ hash: codes[0].code_hash, password: normalizeCode(code) }) : false;
  if (!ok || !user) throw new Error("E-Mail oder Wiederherstellungscode ist falsch.");
  const passwordHash = await hashPassword(newPassword);
  const updated = await sql`
    update "account" set "password" = ${passwordHash}, "updatedAt" = now()
    where "userId" = ${user.id} and "providerId" = 'credential'
    returning "id"
  `;
  if (!updated.length) {
    throw new Error("Für dieses Konto gibt es kein Passwort. Melde dich mit Google oder X an.");
  }
}

export async function assertRate(userId: string, kind: string, limit: number, window: "10 minutes" | "1 hour" | "1 day") {
  const sql = await db();
  const rows = await sql<{ n: number }>`
    select count(*) as n from usage_events
    where user_id = ${userId} and kind = ${kind} and created_at > now() - ${window}::interval
  `;
  if (Number(rows[0]?.n ?? 0) >= limit) {
    throw new Error("Zu viele Anfragen in kurzer Zeit. Bitte einen Moment warten.");
  }
}

export async function recordUsage(userId: string, kind: string) {
  const sql = await db();
  await sql`insert into usage_events (id, user_id, kind) values (${crypto.randomUUID()}, ${userId}, ${kind})`;
  if (Math.random() < 0.05) {
    await sql`delete from usage_events where created_at < now() - interval '2 days'`;
  }
}

function mapConversation(row: {
  id: string;
  title: string;
  mode: string;
  project_id: string | null;
  updated_at: unknown;
}): ConversationDTO {
  return {
    id: row.id,
    title: row.title,
    mode: isMode(row.mode) ? row.mode : "normal",
    projectId: row.project_id,
    updatedAt: iso(row.updated_at),
  };
}

export async function listConversations(
  userId: string,
  opts: { projectId?: string | null; query?: string; before?: string | null },
): Promise<ConversationDTO[]> {
  const sql = await db();
  const q = (opts.query ?? "").trim().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await sql<{
      id: string;
      title: string;
      mode: string;
      project_id: string | null;
      updated_at: unknown;
    }>`
      select distinct c.id, c.title, c.mode, c.project_id, c.updated_at
      from conversations c
      left join messages m on m.conversation_id = c.id and m.user_id = c.user_id
      where c.user_id = ${userId}
        and (${opts.projectId ?? null}::text is null or c.project_id = ${opts.projectId ?? null})
        and (c.title ilike ${like} or m.content ilike ${like})
      order by c.updated_at desc
      limit 40
    `;
    return rows.map(mapConversation);
  }
  const rows = await sql<{
    id: string;
    title: string;
    mode: string;
    project_id: string | null;
    updated_at: unknown;
  }>`
    select id, title, mode, project_id, updated_at from conversations
    where user_id = ${userId}
      and (${opts.projectId ?? null}::text is null or project_id = ${opts.projectId ?? null})
      and (${opts.before ?? null}::timestamptz is null or updated_at < ${opts.before ?? null}::timestamptz)
    order by updated_at desc
    limit 40
  `;
  return rows.map(mapConversation);
}

export async function renameConversation(userId: string, id: string, title: string) {
  assertId(id);
  const sql = await db();
  const next = title.trim().slice(0, 120);
  if (!next) throw new Error("Der Titel darf nicht leer sein.");
  const rows = await sql`update conversations set title = ${next}, updated_at = now() where id = ${id} and user_id = ${userId} returning id`;
  if (!rows.length) throw new Error("Unterhaltung nicht gefunden.");
}

export async function deleteConversation(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from conversations where id = ${id} and user_id = ${userId}`;
}

export async function setConversationMode(userId: string, id: string, mode: Mode) {
  assertId(id);
  const sql = await db();
  await sql`update conversations set mode = ${mode}, updated_at = now() where id = ${id} and user_id = ${userId}`;
}

function mapMessage(row: {
  id: string;
  role: string;
  content: string;
  reasoning: string;
  citations: unknown;
  attachments: unknown;
  image_data: string | null;
  status: string;
  created_at: unknown;
}): MessageDTO {
  const status =
    row.status === "streaming" || row.status === "error" || row.status === "stopped" ? row.status : "complete";
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content ?? "",
    reasoning: row.reasoning ?? "",
    citations: asArray<Citation>(row.citations).filter((c) => c && typeof c.url === "string"),
    attachments: asArray<AttachmentRef>(row.attachments).filter((a) => a && typeof a.id === "string"),
    imageData: row.image_data && row.image_data.startsWith("data:image/") ? row.image_data : null,
    status,
    createdAt: iso(row.created_at),
  };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  before?: string | null,
): Promise<{ messages: MessageDTO[]; hasMore: boolean }> {
  assertId(conversationId);
  const sql = await db();
  const owned = await sql`select id from conversations where id = ${conversationId} and user_id = ${userId} limit 1`;
  if (!owned.length) return { messages: [], hasMore: false };
  const rows = await sql<{
    id: string;
    role: string;
    content: string;
    reasoning: string;
    citations: unknown;
    attachments: unknown;
    image_data: string | null;
    status: string;
    created_at: unknown;
  }>`
    select id, role, content, reasoning, citations, attachments, image_data, status, created_at
    from messages
    where conversation_id = ${conversationId} and user_id = ${userId}
      and (${before ?? null}::timestamptz is null or created_at < ${before ?? null}::timestamptz)
    order by created_at desc
    limit 41
  `;
  const hasMore = rows.length > 40;
  return { messages: rows.slice(0, 40).reverse().map(mapMessage), hasMore };
}

export async function getOwnedConversation(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  const rows = await sql<{
    id: string;
    title: string;
    mode: string;
    project_id: string | null;
  }>`select id, title, mode, project_id from conversations where id = ${id} and user_id = ${userId} limit 1`;
  return rows[0] ?? null;
}

export async function createConversation(userId: string, opts: { projectId?: string | null; mode: Mode; title?: string }) {
  if (opts.projectId) {
    assertId(opts.projectId);
    const project = await getProject(userId, opts.projectId);
    if (!project) throw new Error("Projekt nicht gefunden.");
  }
  const sql = await db();
  const id = crypto.randomUUID();
  const title = (opts.title ?? "Neue Unterhaltung").slice(0, 120);
  await sql`
    insert into conversations (id, user_id, project_id, title, mode)
    values (${id}, ${userId}, ${opts.projectId ?? null}, ${title}, ${opts.mode})
  `;
  const created = await getOwnedConversation(userId, id);
  if (!created) throw new Error("Unterhaltung konnte nicht angelegt werden.");
  return mapConversation({ ...created, project_id: created.project_id, updated_at: new Date() });
}

export async function loadRecentMessages(userId: string, conversationId: string, limit = 24) {
  const sql = await db();
  const rows = await sql<{
    id: string;
    role: string;
    content: string;
    attachments: unknown;
    created_at: unknown;
  }>`
    select id, role, content, attachments, created_at from (
      select id, role, content, attachments, created_at from messages
      where conversation_id = ${conversationId} and user_id = ${userId} and status <> 'error'
      order by created_at desc
      limit ${limit}
    ) t order by created_at asc
  `;
  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: row.content ?? "",
    attachments: asArray<AttachmentRef>(row.attachments),
  }));
}

export async function insertMessage(input: {
  userId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  citations?: Citation[];
  attachments?: AttachmentRef[];
  imageData?: string | null;
  status?: MessageDTO["status"];
}): Promise<MessageDTO> {
  const sql = await db();
  const id = crypto.randomUUID();
  const rows = await sql<{
    id: string;
    role: string;
    content: string;
    reasoning: string;
    citations: unknown;
    attachments: unknown;
    image_data: string | null;
    status: string;
    created_at: unknown;
  }>`
    insert into messages (
      id, conversation_id, user_id, role, content, reasoning, citations, attachments, image_data, status
    ) values (
      ${id},
      ${input.conversationId},
      ${input.userId},
      ${input.role},
      ${input.content},
      ${input.reasoning ?? ""},
      ${JSON.stringify(input.citations ?? [])}::jsonb,
      ${JSON.stringify(input.attachments ?? [])}::jsonb,
      ${input.imageData ?? null},
      ${input.status ?? "complete"}
    )
    returning id, role, content, reasoning, citations, attachments, image_data, status, created_at
  `;
  await sql`update conversations set updated_at = now() where id = ${input.conversationId} and user_id = ${input.userId}`;
  const row = rows[0];
  if (!row) throw new Error("Nachricht konnte nicht gespeichert werden.");
  return mapMessage(row);
}

export async function updateMessage(
  userId: string,
  id: string,
  patch: Partial<{ content: string; reasoning: string; citations: Citation[]; imageData: string | null; status: MessageDTO["status"] }>,
) {
  assertId(id);
  const sql = await db();
  const current = await sql<{
    content: string;
    reasoning: string;
    citations: unknown;
    image_data: string | null;
    status: string;
  }>`select content, reasoning, citations, image_data, status from messages where id = ${id} and user_id = ${userId} limit 1`;
  const row = current[0];
  if (!row) return;
  const citations = patch.citations ?? asArray<Citation>(row.citations);
  await sql`
    update messages set
      content = ${patch.content ?? row.content},
      reasoning = ${patch.reasoning ?? row.reasoning},
      citations = ${JSON.stringify(citations)}::jsonb,
      image_data = ${patch.imageData === undefined ? row.image_data : patch.imageData},
      status = ${patch.status ?? row.status}
    where id = ${id} and user_id = ${userId}
  `;
}

export async function deleteFromMessage(userId: string, conversationId: string, messageId: string) {
  assertId(conversationId);
  assertId(messageId);
  const sql = await db();
  const rows = await sql<{ created_at: unknown }>`
    select created_at from messages
    where id = ${messageId} and conversation_id = ${conversationId} and user_id = ${userId}
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Nachricht nicht gefunden.");
  await sql`
    delete from messages
    where conversation_id = ${conversationId} and user_id = ${userId} and created_at >= ${iso(row.created_at)}::timestamptz
  `;
}

export async function deleteLastAssistant(userId: string, conversationId: string) {
  const sql = await db();
  const rows = await sql<{ id: string; role: string }>`
    select id, role from messages
    where conversation_id = ${conversationId} and user_id = ${userId}
    order by created_at desc
    limit 1
  `;
  if (rows[0]?.role === "assistant") {
    await sql`delete from messages where id = ${rows[0].id} and user_id = ${userId}`;
  }
}

function mapMemory(row: {
  id: string;
  category: string;
  title: string;
  content: string;
  source_note?: string | null;
  confidence?: string | null;
  status?: string | null;
  created_at: unknown;
  updated_at: unknown;
  verified_at?: unknown;
}): MemoryDTO {
  const rawConfidence = row.confidence ?? "";
  const confidence = isMemoryConfidence(rawConfidence) ? rawConfidence : "";
  return {
    id: row.id,
    category: isMemoryCategory(row.category) ? row.category : "long_term",
    title: row.title,
    content: row.content,
    source: row.source_note ?? "",
    confidence: confidence || "",
    status: row.status === "verified" ? "verified" : "active",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  };
}

export async function listMemories(userId: string): Promise<MemoryDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    category: string;
    title: string;
    content: string;
    source_note: string;
    confidence: string;
    status: string;
    created_at: unknown;
    updated_at: unknown;
    verified_at: unknown;
  }>`
    select id, category, title, content, source_note, confidence, status, created_at, updated_at, verified_at
    from memories where user_id = ${userId} order by updated_at desc limit 200
  `;
  return rows.map(mapMemory);
}

export async function saveMemory(
  userId: string,
  input: {
    id?: string;
    category: MemoryCategory;
    title: string;
    content: string;
    source?: string;
    confidence?: string;
  },
) {
  const title = input.title.trim().slice(0, 140);
  const content = input.content.trim().slice(0, 4000);
  const source = (input.source ?? "").trim().slice(0, 300);
  const rawConfidence = input.confidence ?? "";
  const confidence = isMemoryConfidence(rawConfidence) ? rawConfidence : "";
  if (!title || !content) throw new Error("Titel und Inhalt brauchen Text.");
  if (!isMemoryCategory(input.category)) throw new Error("Unbekannte Kategorie.");
  const sql = await db();
  if (input.id) {
    assertId(input.id);
    const existing = await sql<{ content: string; title: string; status: string; verified_at: unknown }>`
      select content, title, status, verified_at from memories where id = ${input.id} and user_id = ${userId} limit 1
    `;
    const prev = existing[0];
    if (!prev) throw new Error("Erinnerung nicht gefunden.");
    const changed = prev.content !== content || prev.title !== title;
    const status = changed ? "active" : prev.status === "verified" ? "verified" : "active";
    const verifiedAt = changed ? null : prev.verified_at ? iso(prev.verified_at) : null;
    await sql`
      update memories
      set category = ${input.category}, title = ${title}, content = ${content},
          source_note = ${source}, confidence = ${confidence}, status = ${status},
          verified_at = ${verifiedAt}, updated_at = now()
      where id = ${input.id} and user_id = ${userId}
    `;
    return input.id;
  }
  const id = crypto.randomUUID();
  await sql`
    insert into memories (id, user_id, category, title, content, source_note, confidence, status)
    values (${id}, ${userId}, ${input.category}, ${title}, ${content}, ${source}, ${confidence}, 'active')
  `;
  return id;
}

export async function markMemoryVerified(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  const rows = await sql`
    update memories set status = 'verified', verified_at = now(), updated_at = now()
    where id = ${id} and user_id = ${userId}
    returning id
  `;
  if (!rows.length) throw new Error("Erinnerung nicht gefunden.");
}

export async function deleteMemory(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from memories where id = ${id} and user_id = ${userId}`;
}

function mapProject(row: {
  id: string;
  name: string;
  summary: string;
  context_notes: string;
  updated_at: unknown;
}): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary ?? "",
    contextNotes: row.context_notes ?? "",
    updatedAt: iso(row.updated_at),
  };
}

export async function listProjects(userId: string): Promise<ProjectDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    name: string;
    summary: string;
    context_notes: string;
    updated_at: unknown;
  }>`select id, name, summary, context_notes, updated_at from projects where user_id = ${userId} order by updated_at desc`;
  return rows.map(mapProject);
}

export async function getProject(userId: string, id: string): Promise<ProjectDTO | null> {
  assertId(id);
  const sql = await db();
  const rows = await sql<{
    id: string;
    name: string;
    summary: string;
    context_notes: string;
    updated_at: unknown;
  }>`select id, name, summary, context_notes, updated_at from projects where id = ${id} and user_id = ${userId} limit 1`;
  return rows[0] ? mapProject(rows[0]) : null;
}

export async function saveProject(
  userId: string,
  input: { id?: string; name: string; summary?: string; contextNotes?: string },
) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Das Projekt braucht einen Namen.");
  const summary = (input.summary ?? "").slice(0, 500);
  const contextNotes = (input.contextNotes ?? "").slice(0, 8000);
  const sql = await db();
  if (input.id) {
    assertId(input.id);
    const rows = await sql`
      update projects set name = ${name}, summary = ${summary}, context_notes = ${contextNotes}, updated_at = now()
      where id = ${input.id} and user_id = ${userId}
      returning id
    `;
    if (!rows.length) throw new Error("Projekt nicht gefunden.");
    return input.id;
  }
  const id = crypto.randomUUID();
  await sql`
    insert into projects (id, user_id, name, summary, context_notes)
    values (${id}, ${userId}, ${name}, ${summary}, ${contextNotes})
  `;
  return id;
}

export async function deleteProject(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from projects where id = ${id} and user_id = ${userId}`;
}

export async function listTasks(userId: string, projectId: string): Promise<TaskDTO[]> {
  assertId(projectId);
  const sql = await db();
  const rows = await sql<{ id: string; title: string; done: boolean }>`
    select id, title, done from project_tasks
    where project_id = ${projectId} and user_id = ${userId}
    order by created_at asc
  `;
  return rows.map((r) => ({ id: r.id, title: r.title, done: Boolean(r.done) }));
}

export async function addTask(userId: string, projectId: string, title: string) {
  const project = await getProject(userId, projectId);
  if (!project) throw new Error("Projekt nicht gefunden.");
  const text = title.trim().slice(0, 200);
  if (!text) throw new Error("Die Aufgabe braucht einen Titel.");
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`insert into project_tasks (id, project_id, user_id, title) values (${id}, ${projectId}, ${userId}, ${text})`;
  return id;
}

export async function toggleTask(userId: string, id: string, done: boolean) {
  assertId(id);
  const sql = await db();
  await sql`update project_tasks set done = ${done} where id = ${id} and user_id = ${userId}`;
}

export async function deleteTask(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from project_tasks where id = ${id} and user_id = ${userId}`;
}

export async function listNotes(userId: string, projectId: string): Promise<NoteDTO[]> {
  assertId(projectId);
  const sql = await db();
  const rows = await sql<{ id: string; title: string; body: string; updated_at: unknown }>`
    select id, title, body, updated_at from project_notes
    where project_id = ${projectId} and user_id = ${userId}
    order by updated_at desc
  `;
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, updatedAt: iso(r.updated_at) }));
}

export async function saveNote(
  userId: string,
  input: { id?: string; projectId: string; title: string; body: string },
) {
  const project = await getProject(userId, input.projectId);
  if (!project) throw new Error("Projekt nicht gefunden.");
  const title = input.title.trim().slice(0, 140);
  const body = input.body.slice(0, 20000);
  if (!title) throw new Error("Die Notiz braucht einen Titel.");
  const sql = await db();
  if (input.id) {
    assertId(input.id);
    const rows = await sql`
      update project_notes set title = ${title}, body = ${body}, updated_at = now()
      where id = ${input.id} and user_id = ${userId} and project_id = ${input.projectId}
      returning id
    `;
    if (!rows.length) throw new Error("Notiz nicht gefunden.");
    return input.id;
  }
  const id = crypto.randomUUID();
  await sql`
    insert into project_notes (id, project_id, user_id, title, body)
    values (${id}, ${input.projectId}, ${userId}, ${title}, ${body})
  `;
  return id;
}

export async function deleteNote(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from project_notes where id = ${id} and user_id = ${userId}`;
}

export async function projectContext(userId: string, projectId: string | null) {
  if (!projectId) return null;
  const project = await getProject(userId, projectId);
  if (!project) return null;
  const [tasks, notes] = await Promise.all([listTasks(userId, projectId), listNotes(userId, projectId)]);
  const noteDigest = notes
    .slice(0, 8)
    .map((n) => `${n.title}\n${n.body}`)
    .join("\n\n")
    .slice(0, 5000);
  return { ...project, tasks, noteDigest };
}

function mapFile(row: {
  id: string;
  name: string;
  mime: string;
  size_bytes: number;
  kind: string;
  excerpt: string;
  project_id: string | null;
  created_at: unknown;
  image_data: string | null;
}): FileDTO {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    kind: row.kind,
    excerpt: row.excerpt ?? "",
    projectId: row.project_id,
    createdAt: iso(row.created_at),
    imageData: row.image_data && row.image_data.startsWith("data:image/") ? row.image_data : null,
  };
}

export async function listFiles(userId: string, projectId?: string | null): Promise<FileDTO[]> {
  const sql = await db();
  const rows = await sql<{
    id: string;
    name: string;
    mime: string;
    size_bytes: number;
    kind: string;
    excerpt: string;
    project_id: string | null;
    created_at: unknown;
    image_data: string | null;
  }>`
    select id, name, mime, size_bytes, kind, left(extracted_text, 180) as excerpt, project_id, created_at,
      case when kind = 'image' and image_data is not null and length(image_data) < 400000 then image_data else null end as image_data
    from files
    where user_id = ${userId}
      and (${projectId ?? null}::text is null or project_id = ${projectId ?? null})
    order by created_at desc
    limit 100
  `;
  return rows.map(mapFile);
}

export async function uploadFile(
  userId: string,
  input: { name: string; mime: string; base64: string; projectId?: string | null },
): Promise<FileDTO> {
  await assertRate(userId, "upload", 40, "1 hour");
  if (input.projectId) {
    const project = await getProject(userId, input.projectId);
    if (!project) throw new Error("Projekt nicht gefunden.");
  }
  const name = safeName(input.name);
  const mime = normalizeMime(input.mime || "", name);
  if (!input.base64 || input.base64.length > 8_200_000) throw new Error("Die Datei ist zu groß.");
  const buf = Buffer.from(input.base64, "base64");
  if (!buf.byteLength) throw new Error("Die Datei ist leer.");
  const extracted = await extractUpload(name, mime, buf);
  const sql = await db();
  const id = crypto.randomUUID();
  await sql`
    insert into files (id, user_id, project_id, name, mime, size_bytes, kind, extracted_text, image_data)
    values (
      ${id}, ${userId}, ${input.projectId ?? null}, ${name}, ${mime}, ${buf.byteLength},
      ${extracted.kind}, ${extracted.text}, ${extracted.imageData}
    )
  `;
  await recordUsage(userId, "upload");
  const listed = await listFiles(userId, input.projectId ?? null);
  return listed.find((f) => f.id === id) ?? {
    id,
    name,
    mime,
    sizeBytes: buf.byteLength,
    kind: extracted.kind,
    excerpt: extracted.text.slice(0, 180),
    projectId: input.projectId ?? null,
    createdAt: new Date().toISOString(),
    imageData: extracted.imageData && extracted.imageData.length < 400000 ? extracted.imageData : null,
  };
}

export async function deleteFile(userId: string, id: string) {
  assertId(id);
  const sql = await db();
  await sql`delete from files where id = ${id} and user_id = ${userId}`;
}

export async function loadFilesForPrompt(userId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 6);
  for (const id of unique) assertId(id);
  if (!unique.length) return [];
  const sql = await db();
  const rows = await sql.query<{
    id: string;
    name: string;
    mime: string;
    kind: string;
    extracted_text: string;
    image_data: string | null;
  }>(
    `select id, name, mime, kind, extracted_text, image_data from files
     where user_id = $1 and id = any($2::text[])`,
    [userId, unique],
  );
  const order = new Map(unique.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function exportData(userId: string) {
  const profile = await ensureProfile(userId);
  const [conversations, memories, projects, files] = await Promise.all([
    listConversations(userId, {}),
    listMemories(userId),
    listProjects(userId),
    listFiles(userId, null),
  ]);
  const sql = await db();
  const messages = await sql<{
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: unknown;
  }>`
    select id, conversation_id, role, content, created_at from messages
    where user_id = ${userId}
    order by created_at asc
    limit 5000
  `;
  return {
    exportedAt: new Date().toISOString(),
    profile,
    conversations,
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      role: m.role,
      content: m.content,
      createdAt: iso(m.created_at),
    })),
    memories,
    projects,
    files: files.map(({ imageData: _image, ...rest }) => rest),
  };
}

export async function deleteAccount(userId: string) {
  const sql = await db();
  await sql`delete from "user" where "id" = ${userId}`;
}

export async function maybeTitle(userId: string, conversationId: string, content: string) {
  const sql = await db();
  const rows = await sql<{ title: string }>`select title from conversations where id = ${conversationId} and user_id = ${userId} limit 1`;
  if (!rows[0] || rows[0].title !== "Neue Unterhaltung") return;
  const title = content.replace(/\s+/g, " ").trim().slice(0, 72) || "Neue Unterhaltung";
  await sql`update conversations set title = ${title} where id = ${conversationId} and user_id = ${userId}`;
}
