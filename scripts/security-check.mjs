import fs from "node:fs";
import path from "node:path";
import { findSecretLeaks } from "./secret-scan.mjs";

const root = process.cwd();
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".data" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs|sql|json|css|html)$/.test(entry.name)) {
      files.push({ path: path.relative(root, full), text: fs.readFileSync(full, "utf8") });
    }
  }
}

walk(path.join(root, "src"));
walk(path.join(root, "migrations"));
walk(path.join(root, "server"));
const leaks = findSecretLeaks(files);
const deployed = process.env.VERCEL_ENV === "production" && process.env.npm_lifecycle_event !== "build";
const gaps = [];
if (deployed) {
  if (!process.env.DATABASE_URL?.trim()) gaps.push("DATABASE_URL");
  if (!process.env.BETTER_AUTH_SECRET?.trim() || process.env.BETTER_AUTH_SECRET.trim().length < 32) gaps.push("BETTER_AUTH_SECRET");
  if (!process.env.BETTER_AUTH_URL?.trim()) gaps.push("BETTER_AUTH_URL");
  if (process.env.VITE_AUTH_ENABLED === "false") gaps.push("AUTH_DISABLED");
}

console.log("SECURITY CHECK");
console.log(leaks.length ? `FAIL secret-scan ${leaks.join(", ")}` : "PASS secret-scan");
console.log(gaps.length ? `FAIL production-config ${gaps.join(", ")}` : deployed ? "PASS production-config" : "NOT_CONFIGURED production-config (diese Umgebung ist nicht der Produktionsstart)");
console.log("NOT_CONFIGURED webauthn");
console.log("NOT_CONFIGURED encryption-at-rest");
console.log("NOT_CONFIGURED production-backup");
console.log("NOT_CONFIGURED database-rls");
console.log("WARNING script-csp");
console.log("WARNING step-up (keine Passwort-Neueingabe)");
if (leaks.length || gaps.length) process.exit(1);
process.exit(0);
