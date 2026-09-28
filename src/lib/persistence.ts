import fs from "node:fs";
import path from "node:path";

/**
 * Decides where data lives. Neon when DATABASE_URL is set.
 * Otherwise a file-backed PGLite directory, not an in-memory database.
 * The URL itself is never returned.
 */

export type PersistenceStatus = "PERSISTENT" | "EXTERNAL" | "NOT_READY" | "NOT_CONFIGURED";
export type BackupStatus = "LOCAL_COPY" | "NOT_CONFIGURED";

export type PersistencePlan = {
  mode: "neon" | "pglite";
  directory: string;
  locationLabel: string;
  persistence: PersistenceStatus;
  backup: BackupStatus;
  backupNote: string;
};

export function persistencePlan(input: {
  databaseUrl?: string;
  cwd: string;
  override?: string;
  directoryExists?: boolean;
  backupExists?: boolean;
}): PersistencePlan {
  const url = input.databaseUrl?.trim() ?? "";
  if (url) {
    return {
      mode: "neon",
      directory: "",
      locationLabel: "Externe Datenbank. Der Verbindungswert wird nicht angezeigt.",
      persistence: "EXTERNAL",
      backup: "NOT_CONFIGURED",
      backupNote: "Ein Backup in der Anwendung ist nicht eingerichtet. Ob der Anbieter sichert, ist nicht geprüft.",
    };
  }
  const directory = input.override?.trim()
    ? path.resolve(input.override.trim())
    : path.join(input.cwd, ".data", "pglite");
  const ready = input.directoryExists === true;
  return {
    mode: "pglite",
    directory,
    locationLabel: "Lokaler Datenordner .data/pglite",
    persistence: ready ? "PERSISTENT" : "NOT_READY",
    backup: input.backupExists ? "LOCAL_COPY" : "NOT_CONFIGURED",
    backupNote: input.backupExists
      ? "Eine lokale Kopie liegt vor. Sie ist nicht verschlüsselt und kein Produktions-Backup."
      : "Noch keine Backup-Kopie. Ein Produktions-Backup ist nicht eingerichtet.",
  };
}

export function assertDirectory(dir: string): void {
  if (!dir.trim()) throw new Error("Speicherort fehlt.");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dir)) throw new Error("Speicherort konnte nicht angelegt werden.");
}

export function backupDirectory(source: string, dest: string): void {
  if (!source.trim() || !fs.existsSync(source)) {
    throw new Error("Speicherort fehlt. Backup nicht erstellt.");
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true, errorOnExist: false });
  if (!fs.existsSync(dest)) throw new Error("Backup wurde nicht geschrieben.");
}

export function restoreDirectory(backup: string, target: string): void {
  if (!backup.trim() || !fs.existsSync(backup)) {
    throw new Error("Backup fehlt. Wiederherstellung abgebrochen.");
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(backup, target, { recursive: true });
  if (!fs.existsSync(target)) throw new Error("Wiederherstellung unvollständig.");
}
