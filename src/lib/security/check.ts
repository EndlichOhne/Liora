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
  stepUp?: boolean;
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
      note: "Cookie: Secure, SameSite=Lax, Path=/, __Host-Name. HttpOnly kommt aus dem Better-Auth-Standard und wird hier nicht ausgeschaltet. Die Sitzung läuft nach 12 Stunden ab. Der Cookie-Cache gilt 5 Minuten.",
    },
    {
      id: "SESSION_ROTATION",
      status: "NOT_CONFIGURED",
      note: "Die Sitzungs-ID wird nicht bei jeder Anfrage rotiert. Export und Löschen verlangen eine eigene Bestätigung, das ist kein zweites Passwort.",
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
        ? "Anmeldung, Registrierung und Zurücksetzen sind auf 10 Versuche in 10 Minuten je Netz begrenzt. Die Meldung nennt kein Konto. Der Text einer falschen Anmeldung kommt weiterhin von Better Auth."
        : "Für Anmeldung und Registrierung ist in diesem Code kein eigenes Limit gesetzt.",
    },
    {
      id: "SECURITY_HEADERS",
      status: "WARNING",
      note: "nosniff, Referrer-Policy und eine enge Permissions-Policy setzt die HTML-Middleware. In der Vorschau kein HSTS und kein frame-ancestors. In Produktion frame-ancestors nur für die eigene Seite und https://grok.com. Eine Script-CSP ist nicht gesetzt, X-Frame-Options auch nicht.",
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
      note: "Recherche-URLs müssen https sein. localhost, private Netze, Metadaten-Hosts und file: werden abgelehnt. Nach der DNS-Auflösung wird die Zieladresse erneut geprüft. Weiterleitungen auch. SQL bleibt parametrisiert.",
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
    {
      id: "STEP_UP",
      status: facts.stepUp ? "WARNING" : "NOT_CONFIGURED",
      note: facts.stepUp
        ? "Export und Löschen gelten 10 Minuten nach einer Bestätigung in den Einstellungen. Das ist keine Passwort-Neueingabe und kein Hardware-Schlüssel."
        : "Eine Bestätigung vor Export oder Löschen ist nicht gemeldet.",
    },
    {
      id: "WEBAUTHN",
      status: "NOT_CONFIGURED",
      note: "WebAuthn oder ein Hardware-Schlüssel ist nicht eingerichtet. Es wird kein eigener Schlüssel gespeichert.",
    },
    {
      id: "CORS",
      status: "WARNING",
      note: "Im Anwendungscode wurde kein Access-Control-Allow-Origin: * gefunden. Eine eigene CORS-Middleware ist nicht eingerichtet.",
    },
    {
      id: "PRODUCTION_FAIL_CLOSED",
      status: "WARNING",
      note: "Ein Produktionsstart ohne Datenbank, Auth-Geheimnis oder Auth-URL wird abgelehnt. Diese Prüfung ist getestet. Diese Umgebung ist nicht automatisch Produktion. Das ist keine Aussage, dass die ausgelieferte Umgebung vollständig konfiguriert ist.",
    },
    {
      id: "CODE_EXECUTION",
      status: "NOT_CONFIGURED",
      note: "Es gibt keinen Code-Ausführer und deshalb auch keine separate Ausführungssandbox.",
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
