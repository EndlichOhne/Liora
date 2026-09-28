import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { buildSecurityReport, exposedClientSecretNames } from "@/lib/security/check";
import { listAudit, writeAudit } from "@/lib/security/log";

export const loadSecurity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { authConfigured } = await import("@/lib/auth/server");
    const report = buildSecurityReport({
      authConfigured,
      sessionCookieHardened: true,
      httpOnlyDefault: true,
      queriesScopedByUser: true,
      filesScopedByUser: true,
      parameterizedSql: true,
      rateLimitOnCostlyRoutes: true,
      loginRateLimit: true,
      auditWrites: true,
      ssrfBlocksPrivate: true,
      exposedClientSecretNames: exposedClientSecretNames(Object.keys(process.env)),
      providerKeyOnServer: Boolean(process.env.XAI_API_KEY?.trim()),
      stepUp: true,
    });
    await writeAudit(context.userId, "SECURITY_EVENT", "settings", "allow");
    const events = await listAudit(context.userId);
    return {
      ...report,
      session: { current: true as const, othersListed: false as const },
      events,
    };
  });
