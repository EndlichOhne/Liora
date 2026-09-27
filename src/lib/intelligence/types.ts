export const AGENT_NAMES = [
  "orchestrator",
  "research",
  "verification",
  "analysis",
  "memory",
  "code",
  "design",
  "performance",
  "security",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export type RouteMode = "fast" | "deep";
export type ModelTier = "simple" | "normal" | "complex" | "extreme";

export type KnowledgeStatus = "unverified" | "current" | "stale" | "conflicted" | "superseded" | "rejected";

export type PipelineStep = {
  name: string;
  outcome: "pass" | "fail" | "stop";
  note: string;
};

export type RouteDecision = {
  mode: RouteMode;
  tier: ModelTier;
  agents: AgentName[];
  parallel: AgentName[];
  reason: string;
};

export type SourceDTO = {
  id: string;
  url: string;
  title: string;
  kind: string;
  reliability: string;
  note: string;
  publishedAt: string;
  checkedAt: string | null;
  createdAt: string;
};

export type VersionDTO = {
  kind: string;
  version: number;
  label: string;
  note: string;
  createdAt: string;
};

export type KnowledgeDTO = {
  id: string;
  topic: string;
  statement: string;
  status: KnowledgeStatus;
  origin: string;
  sourceLabel: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
  steps: PipelineStep[];
};

export type ErrorDTO = {
  id: string;
  originalAnswer: string;
  errorText: string;
  correction: string;
  sourceNote: string;
  cause: string;
  lesson: string;
  createdAt: string;
  correctedAt: string | null;
};

export type GapDTO = {
  id: string;
  question: string;
  missing: string;
  status: string;
  resolution: string;
  updatedAt: string;
};

export type RunDTO = {
  id: string;
  agent: string;
  parentId: string | null;
  mode: string;
  tier: string;
  status: string;
  summary: string;
  durationMs: number | null;
  startedAt: string;
};

export type ProposalDTO = {
  id: string;
  agent: string;
  kind: string;
  title: string;
  body: string;
  risk: string;
  status: string;
  effect: string;
  createdAt: string;
};

export type ClaimDTO = {
  id: string;
  claim: string;
  status: string;
  primaryNote: string;
  secondaryNote: string;
  conflictNote: string;
  createdAt: string;
};

export type CycleReport = {
  measured: true;
  from: string;
  to: string;
  intakeWaiting: number;
  intakeProcessed: number;
  sourcesAdded: number;
  knowledgeCreated: number;
  rowsTouched: number;
  contradictions: number;
  errorsFound: number;
  errorsCorrected: number;
  gapsOpened: number;
  gapsClosed: number;
  staleMarked: number;
  weakUnverified: number;
  benchPassed: number;
  benchFailed: number;
  benchRegressed: boolean | null;
  proposalsOpened: number;
  selfCheckFlags: number;
};

export type CycleDTO = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  report: CycleReport | null;
};

export type BenchCaseDTO = {
  id: string;
  title: string;
  dimension: string;
};

export type ProbeDTO = {
  id: string;
  modelId: string;
  expected: string;
  output: string;
  passed: boolean;
  latencyMs: number;
  createdAt: string;
};

export type EvalFlag = { code: string; detail: string };

export type SystemBoard = {
  versions: VersionDTO[];
  inventory: {
    knowledge: Record<KnowledgeStatus, number>;
    sources: number;
    sourcesChecked: number;
    memories: number;
    rules: number;
    gapsOpen: number;
    errors: number;
    errorsCorrected: number;
    proposalsPending: number;
    usageChat: number;
    usageResearch: number;
  };
  latency: { n: number; medianMs: number } | null;
  modelId: string;
  latestCycle: CycleDTO | null;
  cycles: CycleDTO[];
  bench: { passed: number; failed: number; latencyMs: number; at: string; failures: { id: string; detail: string }[] } | null;
  cases: BenchCaseDTO[];
  recentFlags: { id: string; flags: EvalFlag[]; createdAt: string }[];
};
