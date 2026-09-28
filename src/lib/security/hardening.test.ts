import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentMatches, normalizeMime } from "../files.server.ts";
import { documentHeaders } from "./headers.ts";
import { assertDeployedConfig, productionGaps } from "./production.ts";
import { checkPublicUrl, ipAllowed, resolveRedirect } from "./public-fetch.ts";
import { stepUpFresh } from "./step-up.ts";

describe("security hardening", () => {
  it("fails closed only for a deployed runtime and never prints secret values", () => {
    assert.deepEqual(productionGaps({ NODE_ENV: "development", npm_lifecycle_event: "dev" }), []);
    assert.deepEqual(productionGaps({ npm_lifecycle_event: "build", VERCEL_ENV: "production" }), []);
    const gaps = productionGaps({ VERCEL_ENV: "production", NODE_ENV: "production" });
    assert.deepEqual(gaps, ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]);
    assert.throws(
      () => assertDeployedConfig({
        VERCEL_ENV: "production",
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:secret@db/app",
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "https://app.example",
      }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        assert.match(message, /BETTER_AUTH_SECRET/);
        assert.equal(message.includes("secret@"), false);
        assert.equal(message.includes("postgres://"), false);
        return true;
      },
    );
  });

  it("blocks private addresses, dns answers and redirects", async () => {
    assert.equal(ipAllowed("8.8.8.8"), true);
    assert.equal(ipAllowed("127.0.0.1"), false);
    assert.equal(ipAllowed("10.1.1.1"), false);
    assert.equal(ipAllowed("169.254.169.254"), false);
    assert.equal(ipAllowed("::1"), false);
    assert.equal(ipAllowed("::ffff:127.0.0.1"), false);
    assert.equal(ipAllowed("fd00::1"), false);
    const blocked = await checkPublicUrl("https://news.example/a", async () => ["127.0.0.1"]);
    assert.equal(blocked, null);
    const allowed = await checkPublicUrl("https://news.example/a", async () => ["8.8.8.8"]);
    assert.equal(allowed, "https://news.example/a");
    assert.equal(resolveRedirect("https://news.example/a", "http://127.0.0.1/secret"), null);
    assert.equal(resolveRedirect("https://news.example/a", "https://news.example/b"), "https://news.example/b");
    assert.equal(await checkPublicUrl("file:///etc/passwd", async () => ["8.8.8.8"]), null);
    assert.equal(await checkPublicUrl("https://169.254.169.254/", async () => []), null);
  });

  it("keeps preview headers frameable and does not add a wildcard script policy", () => {
    const preview = documentHeaders({ deployed: false });
    assert.equal(preview["x-content-type-options"], "nosniff");
    assert.equal("content-security-policy" in preview, false);
    assert.equal("strict-transport-security" in preview, false);
    const deployed = documentHeaders({ deployed: true });
    assert.match(deployed["content-security-policy"], /frame-ancestors/);
    assert.match(deployed["content-security-policy"], /https:\/\/grok\.com/);
    assert.equal(deployed["content-security-policy"].includes("*"), false);
    assert.equal(deployed["content-security-policy"].includes("unsafe-eval"), false);
    assert.equal(JSON.stringify(deployed).includes("Access-Control-Allow-Origin"), false);
  });

  it("requires a fresh confirmation and rejects a disguised upload", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    assert.equal(stepUpFresh(null, now), false);
    assert.equal(stepUpFresh("2026-09-28T11:55:00.000Z", now), true);
    assert.equal(stepUpFresh("2026-09-28T11:40:00.000Z", now), false);
    assert.equal(contentMatches("application/pdf", Buffer.from("%PDF-1.7")), true);
    assert.equal(contentMatches("application/pdf", Buffer.from("MZ-not-a-pdf")), false);
    assert.throws(() => normalizeMime("application/pdf", "bericht.exe"), /nicht unterstützt/);
    assert.equal(normalizeMime("text/plain", "../geheim.txt"), "text/plain");
  });
});
