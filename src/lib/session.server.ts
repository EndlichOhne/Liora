import { auth } from "@/lib/auth/server";

export async function requireRequestUser(request: Request): Promise<string> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) throw Object.assign(new Error("Forbidden"), { status: 403 });
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  if (originHost !== host) throw Object.assign(new Error("Forbidden"), { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  const id = session?.user?.id;
  if (!id) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return id;
}
