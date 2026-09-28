import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import { backupDirectory, persistencePlan, restoreDirectory } from "./persistence.ts";

describe("persistent local database", () => {
  it("does not echo a database url and does not claim a backup that does not exist", () => {
    const neon = persistencePlan({ databaseUrl: "postgres://user:secret@db.example/app", cwd: "/app" });
    assert.equal(neon.mode, "neon");
    assert.equal(neon.persistence, "EXTERNAL");
    assert.equal(neon.backup, "NOT_CONFIGURED");
    assert.equal(JSON.stringify(neon).includes("secret"), false);
    assert.equal(JSON.stringify(neon).includes("postgres://"), false);
    const local = persistencePlan({ cwd: "/app", directoryExists: true, backupExists: false });
    assert.equal(local.mode, "pglite");
    assert.equal(local.persistence, "PERSISTENT");
    assert.equal(local.backup, "NOT_CONFIGURED");
    assert.equal(persistencePlan({ cwd: "/app", directoryExists: false }).persistence, "NOT_READY");
  });

  it("keeps a row after close and restore, and does not swallow a missing backup", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "liora-db-"));
    const dir = path.join(root, "live");
    const copy = path.join(root, "backup");
    const first = new PGlite(dir);
    await first.waitReady;
    await first.exec("create table if not exists keep_probe (id text primary key)");
    await first.exec("insert into keep_probe (id) values ('bleibt')");
    await first.close();
    const reopened = new PGlite(dir);
    await reopened.waitReady;
    const rows = await reopened.query<{ id: string }>("select id from keep_probe");
    assert.equal(rows.rows[0]?.id, "bleibt");
    await reopened.close();
    backupDirectory(dir, copy);
    await assert.rejects(() => Promise.resolve().then(() => backupDirectory(path.join(root, "missing"), path.join(root, "nope"))), /Backup nicht erstellt/);
    const changed = new PGlite(dir);
    await changed.waitReady;
    await changed.exec("delete from keep_probe");
    await changed.close();
    restoreDirectory(copy, dir);
    const restored = new PGlite(dir);
    await restored.waitReady;
    const again = await restored.query<{ id: string }>("select id from keep_probe");
    assert.equal(again.rows[0]?.id, "bleibt");
    await restored.close();
    const applied = pendingMigrations(["/migrations/0015_case_intelligence.sql"], []);
    assert.equal(applied.length, 1);
    assert.equal(pendingMigrations(["/migrations/0015_case_intelligence.sql"], ["0015_case_intelligence.sql"]).length, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
