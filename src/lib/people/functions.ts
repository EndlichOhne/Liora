import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseEvidence } from "@/lib/cases/store";
import { isRegion } from "@/lib/cases/engine";
import {
  attachPersonCase,
  attachPersonSource,
  createPerson,
  getPersonFile,
  listPeople,
  markPersonReviewed,
} from "@/lib/people/store";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function record(input: unknown): Record<string, unknown> {
  return (input ?? {}) as Record<string, unknown>;
}

function year(value: unknown): number | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}$/.test(text)) throw new Error("Geburtsjahr ist keine belegte Jahreszahl.");
  return Number(text);
}

function region(value: unknown): string | null {
  const text = str(value, 40);
  if (!text) return null;
  if (!isRegion(text)) throw new Error("Region ist ungültig.");
  return text;
}

function aliases(value: unknown): string[] {
  return str(value, 500)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export const loadPeople = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return { query: str(data.query, 120), role: str(data.role, 40), region: str(data.region, 40), status: str(data.status, 40) };
  })
  .handler(async ({ context, data }) => listPeople(context.userId, data));

export const loadPerson = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => getPersonFile(context.userId, data.id));

export const openPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      displayName: str(data.displayName, 140),
      aliases: aliases(data.aliases),
      role: str(data.role, 40),
      birthYear: year(data.birthYear),
      nationality: str(data.nationality, 80) || null,
      region: region(data.region),
      summary: str(data.summary, 2000),
      sourceUrl: str(data.sourceUrl, 500),
      evidence: parseEvidence(data.evidence),
      sourceRelation: str(data.sourceRelation, 40) || "identifies",
    };
  })
  .handler(async ({ context, data }) => createPerson(context.userId, data));

export const addPersonLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      personId: str(data.personId, 80),
      sourceUrl: str(data.sourceUrl, 500),
      relation: str(data.relation, 40),
      evidence: parseEvidence(data.evidence),
      title: str(data.title, 180),
    };
  })
  .handler(async ({ context, data }) => attachPersonSource(context.userId, data));

export const addPersonCase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      personId: str(data.personId, 80),
      caseId: str(data.caseId, 80),
      relation: str(data.relation, 40),
      evidence: parseEvidence(data.evidence),
      sourceId: str(data.sourceId, 80),
    };
  })
  .handler(async ({ context, data }) => attachPersonCase(context.userId, data));

export const reviewPersonFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => markPersonReviewed(context.userId, data.id));

