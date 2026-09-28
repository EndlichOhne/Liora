export type CheckStatus = "PASS" | "WARNING" | "FAIL" | "NOT_CONFIGURED";

export type SecurityCheck = {
  id: string;
  status: CheckStatus;
  note: string;
};

export type SecurityFacts = {
  authConfigured: boolean;
  sessionCookieHardened: boolean;
  httpOnlyDefault: boolean;
  queriesScopedByUser: boolean;
  filesScopedByUser: boolean;
  parameterizedSql: boolean;
  rateLimitOnCostlyRoutes: boolean;
  loginRateLimit: boolean;
  auditWrites: boolean;
  ssrfBlocksPrivate: boolean;
  exposedClientSecretNames: string[];
  providerKeyOnServer: boolean;
};

const FORBIDDEN = /100\s*%\s*sicher|unhackable|100%\s*secure/i;

export function securityLine(passed: number, total: number): string {
  return `Security Check: ${passed}/${total} Kontrollen bestanden.`;
}

export function buildSecurityReport(facts: SecurityFacts): {
  checks: SecurityCheck[];
  passed: number;
  total: number;
  line: string;
} {
  const checks: SecurityCheck[] = [
    {
      id: "AUTH_CONFIGURED",
      status: facts.authConfigured ? "PASS" : "NOT_CONFIGURED",
      note: facts.authConfigured
        ? "Anmeldung ist eingeschaltet. Geschützte Funktionen verlangen eine Sitzung."
        : "Anmeldung ist in dieser Umgebung nicht eingeschaltet.",
    },
    {
      id: "USER_ISOLATION",
      status: facts.queriesScopedByUser ? "PASS" : "FAIL",
      note: "Private Abfragen filtern serverseitig mit user_id. Eine fremde ID liefert dasselbe „nicht gefunden“ wie eine fehlende ID.",
    },
    {
      id: "DATABASE_RLS",
      status: "NOT_CONFIGURED",
      note: "Row Level Security ist nicht aktiv. Die App verbindet sich als Tabellenbesitzer. RLS wird nicht blind eingeschaltet.",
    },
    {
      id: "SESSION_SECURITY",
      status: facts.sessionCookieHardened && facts.httpOnlyDefault ? "PASS" : "WARNING",
      note: "Cookie: Secure, SameSite=Lax, Path=/, __Host-Name. HttpOnly kommt aus dem Better-Auth-Standard und wird hier nicht ausgeschaltet. Ablauf der Sitzung ist der Better-Auth-Standard von 7 Tagen. Eine zusätzliche Rotation ist nicht eingebaut.",
    },
    {
      id: "SESSION_ROTATION",
      status: "NOT_CONFIGURED",
      note: "Eine erneute Anmeldung für Export oder Löschen ist nicht eingebaut.",
    },
    {
      id: "SECRET_CONFIGURATION",
      status: facts.exposedClientSecretNames.length ? "FAIL" : "PASS",
      note: facts.exposedClientSecretNames.length
        ? `Diese Namen sehen nach Schlüsseln im Client aus: ${facts.exposedClientSecretNames.join(", ")}. Werte werden nicht angezeigt.`
        : "Kein Schlüsselname mit VITE_ und SECRET, TOKEN, PASSWORD, API_KEY oder DATABASE_URL. Werte werden nicht angezeigt.",
    },
    {
      id: "FILE_ACCESS_CONTROL",
      status: facts.filesScopedByUser ? "PASS" : "FAIL",
      note: "Dateien werden mit user_id gelesen und geschrieben. Der Dateiname allein erlaubt keinen Zugriff.",
    },
    {
      id: "AI_PROVIDER_SECURITY",
      status: "WARNING",
      note: facts.providerKeyOnServer
        ? "xAI wird nur vom Server aufgerufen. Gesendet werden die Nachricht und der nötige Kontext dieses Kontos, nicht Daten anderer Konten. Die Aufbewahrung beim Anbieter ist nicht geprüft. Der Schlüsselwert wird nicht angezeigt."
        : "In dieser Umgebung ist kein serverseitiger xAI-Schlüssel gesetzt. Es werden keine Daten anderer Konten gesendet. Der Schlüsselwert wird nicht angezeigt.",
    },
    {
      id: "RATE_LIMITING",
      status: facts.rateLimitOnCostlyRoutes ? "PASS" : "FAIL",
      note: "Chat, Recherche, Fallscan, Upload, Bild, Sprache, Wiederherstellung und Zurücksetzen haben ein Limit.",
    },
    {
      id: "LOGIN_RATE_LIMIT",
      status: facts.loginRateLimit ? "PASS" : "NOT_CONFIGURED",
      note: facts.loginRateLimit
        ? "Anmeldung und Registrierung haben ein Limit."
        : "Für Anmeldung und Registrierung ist in diesem Code kein eigenes Limit gesetzt.",
    },
    {
      id: "SECURITY_HEADERS",
      status: "NOT_CONFIGURED",
      note: "nosniff und Referrer-Policy werden auf HTML gesetzt. CSP, HSTS und X-Frame-Options sind nicht gesetzt, weil die Grok-Vorschau die App in einem iframe zeigt.",
    },
    {
      id: "AUDIT_LOGGING",
      status: facts.auditWrites ? "PASS" : "NOT_CONFIGURED",
      note: "Gespeichert werden Aktion, Ressource und Ergebnis. Keine Passwörter, Tokens oder Dokumentinhalte.",
    },
    {
      id: "BACKUP_SECURITY",
      status: "NOT_CONFIGURED",
      note: "Backups, Zugriff darauf und ein Restore-Test sind nicht eingerichtet.",
    },
    {
      id: "ENCRYPTION_AT_REST",
      status: "NOT_CONFIGURED",
      note: "Verschlüsselung der Datenbank im Ruhezustand wurde nicht geprüft.",
    },
    {
      id: "SSRF",
      status: facts.ssrfBlocksPrivate && facts.parameterizedSql ? "PASS" : "FAIL",
      note: "Recherche-URLs müssen https sein. localhost, private Netze, Metadaten-Hosts und file: werden abgelehnt. SQL bleibt parametrisiert.",
    },
    {
      id: "PROMPT_BOUNDARY",
      status: "PASS",
      note: "Dokumenttext bleibt Daten. Eine Aufforderung im Dokument wird nicht zur Systemanweisung.",
    },
    {
      id: "AGENT_ISOLATION",
      status: "WARNING",
      note: "Ein Rechtekatalog verweigert fremde Werkzeuge. Es gibt keinen separaten Tool-Runner, der das für jeden Agenten erzwingt.",
    },
  ];
  const passed = checks.filter((item) => item.status === "PASS").length;
  const line = securityLine(passed, checks.length);
  if (FORBIDDEN.test(line) || checks.some((item) => /100\s*%\s*sicher|unhackable/i.test(item.note))) {
    throw new Error("Die Sicherheitsanzeige ist unzulässig.");
  }
  return { checks, passed, total: checks.length, line };
}

const SECRET = /(?:password|passwd|api[_-]?key|secret|bearer\s|postgres(?:ql)?:\/\/|database_url|\.env\b|stack trace)/i;

export function redactError(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text || SECRET.test(text) || (text.includes(" at ") && /\.(ts|js|mjs):\d+/.test(text))) {
    return "Die Aktion ist fehlgeschlagen.";
  }
  return text.slice(0, 240);
}

export function untrustedData(value: string): { data: string; instruction: false } {
  return { data: value, instruction: false };
}

const AGENT_TOOLS: Record<string, readonly string[]> = {
  research: ["web_search", "write_research", "write_source"],
  memory: ["read_memory", "write_memory"],
  security: ["read_audit"],
};

export function allowAgentTool(agent: string, tool: string): boolean {
  return (AGENT_TOOLS[agent] ?? []).includes(tool);
}

export function exposedClientSecretNames(keys: string[]): string[] {
  return keys.filter((key) => key.startsWith("VITE_") && /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|PRIVATE/i.test(key));
}
