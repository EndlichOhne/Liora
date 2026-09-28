import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth/server";
import { assertRate, recordUsage } from "@/lib/data.server";

async function limitAuthPost(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/sign-in|sign-up|forget-password|request-password-reset|reset-password/i.test(path)) return null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const bucket = `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
  try {
    await assertRate(bucket, "login", 10, "10 minutes");
    await recordUsage(bucket, "login");
  } catch {
    return new Response(JSON.stringify({ message: "Zu viele Anfragen. Bitte einen Moment warten." }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) => (await limitAuthPost(request)) ?? auth.handler(request),
    },
  },
});
