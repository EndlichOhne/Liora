/**
 * Deployed runtime must refuse to start when a critical setting is missing.
 * Preview and `npm run build` are not that runtime.
 * Secret values are never included in the error.
 */

export function isDeployedRuntime(env: Record<string, string | undefined>): boolean {
  const event = env.npm_lifecycle_event ?? "";
  if (event === "build" || event === "dev" || event === "test") return false;
  if (env.VERCEL_ENV === "production") return true;
  return Boolean(env.GROK_PROJECT_ID?.trim()) && env.NODE_ENV === "production" && event !== "preview";
}

export function productionGaps(env: Record<string, string | undefined>): string[] {
  if (!isDeployedRuntime(env)) return [];
  const gaps: string[] = [];
  if (!env.DATABASE_URL?.trim()) gaps.push("DATABASE_URL");
  if (!env.BETTER_AUTH_SECRET?.trim() || env.BETTER_AUTH_SECRET.trim().length < 32) gaps.push("BETTER_AUTH_SECRET");
  if (!env.BETTER_AUTH_URL?.trim()) gaps.push("BETTER_AUTH_URL");
  if (env.VITE_AUTH_ENABLED === "false") gaps.push("AUTH_DISABLED");
  return gaps;
}

export function assertDeployedConfig(env: Record<string, string | undefined>): void {
  const gaps = productionGaps(env);
  if (!gaps.length) return;
  throw new Error(`Produktion startet nicht. Es fehlt: ${gaps.join(", ")}. Werte werden nicht angezeigt.`);
}
