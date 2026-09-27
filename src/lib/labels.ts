export const AGENT_LABEL: Record<string, string> = {
  orchestrator: "Orchestrierung",
  research: "Recherche",
  verification: "Prüfung",
  analysis: "Analyse",
  memory: "Erinnerung",
  code: "Code",
  design: "Gestaltung",
  security: "Sicherheit",
  performance: "Leistung",
};

export const AGENT_ORDER = [
  "research",
  "analysis",
  "verification",
  "code",
  "memory",
  "design",
  "security",
  "performance",
] as const;

export function agentLabel(name: string) {
  return AGENT_LABEL[name] ?? name;
}
