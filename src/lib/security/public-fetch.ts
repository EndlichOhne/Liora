import { lookup } from "node:dns/promises";
import { safePublicUrl } from "../cases/engine.ts";

export function ipAllowed(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "::" || host === "0.0.0.0") return false;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  const mapped = host.startsWith("::ffff:") ? host.slice(7) : host;
  const ipv4 = mapped.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return host.includes(":") ? !host.startsWith("ff") : true;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

export async function checkPublicUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = resolvePublicHost,
): Promise<string | null> {
  const url = safePublicUrl(raw);
  if (!url) return null;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return ipAllowed(host) ? url : null;
  let ips: string[] = [];
  try {
    ips = await resolve(host);
  } catch {
    return null;
  }
  if (!ips.length || ips.some((ip) => !ipAllowed(ip))) return null;
  return url;
}

async function resolvePublicHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export function resolveRedirect(current: string, location: string): string | null {
  try {
    return safePublicUrl(new URL(location, current).toString());
  } catch {
    return null;
  }
}

export async function publicFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let current = await checkPublicUrl(raw);
  if (!current) throw new Error("Die Adresse ist nicht öffentlich abrufbar.");
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const next = resolveRedirect(current, location);
    if (!next) throw new Error("Die Weiterleitung ist nicht öffentlich abrufbar.");
    const checked = await checkPublicUrl(next);
    if (!checked) throw new Error("Die Weiterleitung ist nicht öffentlich abrufbar.");
    current = checked;
  }
  throw new Error("Zu viele Weiterleitungen.");
}
