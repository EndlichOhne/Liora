import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { appendFindingVersion, loadCoreDesk, runCore } from "@/lib/intelligence/core-store";

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const loadIntelligence = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadCoreDesk(context.userId));

export const askIntelligence = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ text: str((input as { text?: string } | null)?.text, 2000) }))
  .handler(async ({ context, data }) => {
    if (data.text.trim().length < 2) throw new Error("Die Frage fehlt.");
    return runCore(context.userId, data.text);
  });

export const versionFinding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const data = (input ?? {}) as Record<string, unknown>;
    return {
      findingId: str(data.findingId, 80),
      value: str(data.value, 2000),
      reason: str(data.reason, 500),
      source: str(data.source, 500),
    };
  })
  .handler(async ({ context, data }) => appendFindingVersion(context.userId, data));
