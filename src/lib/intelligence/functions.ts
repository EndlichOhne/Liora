import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { compareProbePair, probeModel, refreshCatalog, runTask } from "@/lib/intelligence/agents";
import {
  acceptKnowledge,
  archiveKnowledge,
  closeGap,
  correctError,
  decideProposal,
  listClaims,
  listErrors,
  listGaps,
  listKnowledge,
  listModelIds,
  listProposals,
  listRuns,
  listSources,
  loadBoard,
  proposeRollback,
  queueIntake,
  runDailyCycle,
  saveSnapshot,
  submitIntake,
} from "@/lib/intelligence/store";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const loadSystem = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadBoard(context.userId));

export const loadKnowledge = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listKnowledge(context.userId));

export const loadErrors = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listErrors(context.userId));

export const loadGaps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listGaps(context.userId));

export const loadRuns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listRuns(context.userId));

export const loadProposals = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listProposals(context.userId));

export const loadClaims = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listClaims(context.userId));

export const loadSources = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listSources(context.userId));

export const loadModels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listModelIds(context.userId));

export const takeIn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      body: str(data.body, 4000),
      url: str(data.url, 500),
      title: str(data.title, 180),
      verified: data.verified === true,
      queue: data.queue === true,
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.body.trim()) throw new Error("Die Aussage fehlt.");
    if (data.queue) {
      const id = await queueIntake(context.userId, data.body, data.url, data.title);
      return { queued: true as const, id };
    }
    const result = await submitIntake(context.userId, data.body, data.url, data.title, data.verified);
    return { queued: false as const, result };
  });

export const markChecked = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await acceptKnowledge(context.userId, data.id);
    return { ok: true as const };
  });

export const archiveFact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => {
    await archiveKnowledge(context.userId, data.id);
    return { ok: true as const };
  });

export const fixError = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { id: str(data.id, 80), correction: str(data.correction, 2000), source: str(data.source, 500) };
  })
  .handler(async ({ context, data }) => {
    await correctError(context.userId, data.id, data.correction, data.source);
    return { ok: true as const };
  });

export const resolveGap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { id: str(data.id, 80), resolution: str(data.resolution, 1000) };
  })
  .handler(async ({ context, data }) => {
    await closeGap(context.userId, data.id, data.resolution);
    return { ok: true as const };
  });

export const runCycle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => runDailyCycle(context.userId));

export const runAgents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { task: str(data.task, 4000), web: data.web === true };
  })
  .handler(async ({ context, data }) => runTask(context.userId, data.task, data.web));

export const settleProposal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { id: str(data.id, 80), approve: data.approve === true };
  })
  .handler(async ({ context, data }) => ({ effect: await decideProposal(context.userId, data.id, data.approve) }));

export const keepSnapshot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => saveSnapshot(context.userId));

export const askRollback = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ id: await proposeRollback(context.userId) }));

export const fetchModels = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => refreshCatalog(context.userId));

export const testModel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ modelId: str((input as { modelId?: string })?.modelId, 64) }))
  .handler(async ({ context, data }) => probeModel(context.userId, data.modelId));

export const compareModels = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return { modelA: str(data.modelA, 64), modelB: str(data.modelB, 64) };
  })
  .handler(async ({ context, data }) => compareProbePair(context.userId, data.modelA, data.modelB));
