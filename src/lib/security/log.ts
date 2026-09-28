import { getSql } from "@/lib/db";

const ACTIONS = new Set([
  "PERSON_ACCESSED",
  "CASE_ACCESSED",
  "PERMISSION_DENIED",
  "SECURITY_EVENT",
  "RESEARCH_STARTED",
]);

export async function writeAudit(userId: string, action: string, resource: string, result: string) {
  if (!userId || !ACTIONS.has(action)) return;
  const cleanResource = resource.replace(/[\r\n]/g, " ").slice(0, 120);
  const cleanResult = result.replace(/[\r\n]/g, " ").slice(0, 40);
  if (/password|token|bearer|postgres:\/\//i.test(`${cleanResource} ${cleanResult}`)) return;
  const db = await getSql();
  await db`
    insert into ci_audit (id, user_id, action, resource, result)
    values (${crypto.randomUUID()}, ${userId}, ${action}, ${cleanResource}, ${cleanResult})
  `;
}

export async function listAudit(userId: string) {
  const db = await getSql();
  const rows = await db<{ action: string; resource: string; result: string; created_at: unknown }>`
    select action, resource, result, created_at
    from ci_audit
    where user_id = ${userId}
    order by created_at desc
    limit 40
  `;
  return rows.map((row) => ({
    action: row.action,
    resource: row.resource,
    result: row.result,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  }));
}
