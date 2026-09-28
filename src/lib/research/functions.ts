import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { listResearchTasks, loadResearchTask, startResearchTask } from "@/lib/research/store";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const loadResearchTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listResearchTasks(context.userId));

export const loadResearch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ id: str((input as { id?: string })?.id, 80) }))
  .handler(async ({ context, data }) => loadResearchTask(context.userId, data.id));

export const startResearch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      request: str(data.request, 2000),
      web: data.web === true,
      caseId: str(data.caseId, 80),
    };
  })
  .handler(async ({ context, data }) => startResearchTask(context.userId, data));
