import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { researchPublicCases, reviewStoredCase, runDeskTick, runDiscoveryJob } from "@/lib/cases/agents";
import {
  addEdge,
  addEvent,
  addHypothesis,
  addItem,
  addPerson,
  attachLead,
  createCase,
  decideCandidate,
  dismissLead,
  getCaseFile,
  listCandidates,
  listCases,
  listLeads,
  listOpenAlerts,
  listWatches,
  loadBoard,
  markAlertSeen,
  markHistorical,
  parseCaseInput,
  parseEvidence,
  parseRole,
  promoteLead,
  reviewOpenCandidates,
  updateCase,
  addUserFeature,
  loadDiscoveryView,
} from "@/lib/cases/store";
import { isCaseStatus } from "@/lib/cases/engine";
import { isFeatureKey, isOrigin } from "@/lib/cases/discovery";
import { fileFromCaseMention } from "@/lib/people/store";
import { writeAudit } from "@/lib/security/log";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function record(input: unknown): Record<string, unknown> {
  return (input ?? {}) as Record<string, unknown>;
}

export const loadDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [board, cases, leads, alerts, watches, candidates] = await Promise.all([
      loadBoard(context.userId),
      listCases(context.userId, {}),
      listLeads(context.userId),
      listOpenAlerts(context.userId),
      listWatches(context.userId),
      listCandidates(context.userId),
    ]);
    return { board, cases, leads, alerts, watches, candidates };
  });

export const loadCase = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => {
    const file = await getCaseFile(context.userId, data.id);
    await writeAudit(context.userId, file ? "CASE_ACCESSED" : "PERMISSION_DENIED", `case:${data.id}`, file ? "allow" : "not_found");
    return file;
  });

export const openCase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseCaseInput(record(input)))
  .handler(async ({ context, data }) => createCase(context.userId, data));

export const saveCaseMeta = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    const caseStatus = str(data.caseStatus, 40);
    if (!isCaseStatus(caseStatus)) throw new Error("Status ist ungültig.");
    return {
      id: str(data.id, 80),
      caseStatus,
      investigationStatus: str(data.investigationStatus, 160),
      authority: str(data.authority, 160),
      courtName: str(data.courtName, 160),
      city: str(data.city, 80),
      district: str(data.district, 80),
      place: str(data.place, 120),
      summary: str(data.summary, 4000),
    };
  })
  .handler(async ({ context, data }) => {
    await updateCase(context.userId, data.id, data);
    return { ok: true as const };
  });

export const addCaseEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      caseId: str(data.caseId, 80),
      occurredOn: str(data.occurredOn, 40),
      label: str(data.label, 180),
      detail: str(data.detail, 2000),
      evidence: parseEvidence(data.evidence),
      sourceUrl: str(data.sourceUrl, 500),
      historical: data.historical === true,
    };
  })
  .handler(async ({ context, data }) => {
    if (data.label.trim().length < 3) throw new Error("Das Ereignis braucht eine Bezeichnung.");
    await addEvent(context.userId, data);
    return { ok: true as const };
  });

export const addCaseItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      caseId: str(data.caseId, 80),
      kind: str(data.kind, 40) || "source",
      evidence: parseEvidence(data.evidence),
      body: str(data.body, 4000),
      sourceUrl: str(data.sourceUrl, 500),
      historical: data.historical === true,
    };
  })
  .handler(async ({ context, data }) => {
    if (data.body.trim().length < 8) throw new Error("Der Eintrag ist zu kurz.");
    await addItem(context.userId, data);
    return { ok: true as const };
  });

export const addCasePerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      caseId: str(data.caseId, 80),
      name: str(data.name, 140),
      role: parseRole(data.role),
      evidence: parseEvidence(data.evidence),
      note: str(data.note, 1000),
      sourceUrl: str(data.sourceUrl, 500),
    };
  })
  .handler(async ({ context, data }) => {
    if (data.name.trim().length < 2) throw new Error("Der Name fehlt.");
    const saved = await addPerson(context.userId, data);
    const filed = await fileFromCaseMention(context.userId, { ...data, mentionId: saved.id });
    return { ok: true as const, personId: filed.personId, note: filed.note };
  });

export const addCaseHypothesis = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      caseId: str(data.caseId, 80),
      title: str(data.title, 180),
      support: str(data.support, 2000),
      contradict: str(data.contradict, 2000),
      unknown: str(data.unknown, 2000),
      alternatives: str(data.alternatives, 2000),
    };
  })
  .handler(async ({ context, data }) => {
    if (data.title.trim().length < 4) throw new Error("Die Hypothese braucht einen Titel.");
    await addHypothesis(context.userId, data);
    return { ok: true as const };
  });

export const addCaseEdge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return {
      caseId: str(data.caseId, 80),
      from: str(data.from, 140),
      relation: str(data.relation, 80),
      to: str(data.to, 140),
      proven: data.proven === true,
      note: str(data.note, 500),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.from.trim() || !data.to.trim() || !data.relation.trim()) throw new Error("Die Beziehung ist unvollständig.");
    await addEdge(context.userId, data);
    return { ok: true as const };
  });

export const keepLead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => promoteLead(context.userId, data.id));

export const dropLead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => {
    await dismissLead(context.userId, data.id);
    return { ok: true as const };
  });

export const bindLead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return { leadId: str(data.leadId, 80), caseId: str(data.caseId, 80) };
  })
  .handler(async ({ context, data }) => {
    await attachLead(context.userId, data.leadId, data.caseId);
    return { ok: true as const };
  });

export const seeAlert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => {
    await markAlertSeen(context.userId, data.id);
    return { ok: true as const };
  });

export const archiveEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    const kind = data.kind === "event" ? "event" : data.kind === "item" ? "item" : "";
    if (!kind) throw new Error("Unbekannter Eintrag.");
    return { kind, id: str(data.id, 80) } as { kind: "event" | "item"; id: string };
  })
  .handler(async ({ context, data }) => {
    await markHistorical(context.userId, data);
    return { ok: true as const };
  });

export const stepDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => runDeskTick(context.userId));

export const researchCases = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => researchPublicCases(context.userId));

export const reviewCandidates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => reviewOpenCandidates(context.userId));

export const settleCandidate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    return { id: str(data.id, 80), accept: data.accept === true };
  })
  .handler(async ({ context, data }) => decideCandidate(context.userId, data.id, data.accept));

export const reviewCase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str(record(input).id, 80) }))
  .handler(async ({ context, data }) => reviewStoredCase(context.userId, data.id));

export const loadDiscovery = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ caseId: str(record(input).caseId, 80) }))
  .handler(async ({ context, data }) => loadDiscoveryView(context.userId, data.caseId));

export const addCaseFeature = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = record(input);
    const key = str(data.key, 40);
    const origin = str(data.origin, 40);
    if (!isFeatureKey(key) || !isOrigin(origin)) throw new Error("Merkmal oder Herkunft ist ungültig.");
    return {
      caseId: str(data.caseId, 80),
      key,
      value: str(data.value, 160),
      origin,
      evidence: parseEvidence(data.evidence),
      sourceUrl: str(data.sourceUrl, 500),
    };
  })
  .handler(async ({ context, data }) => addUserFeature(context.userId, data));

export const compareFeatures = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => runDiscoveryJob(context.userId));
