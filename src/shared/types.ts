export type HardwareTier = 1 | 2 | 2.5 | 3;

export type GpuVendor = "nvidia" | "amd" | "intel" | "apple" | "none";

export interface GpuInfo {
  vendor: GpuVendor;
  vramBytes: number | null;
  name: string | null;
}

export interface HardwareProfile {
  os: "darwin" | "win32" | "linux";
  arch: "x64" | "arm64";
  totalRamBytes: number;
  freeRamBytes: number;
  isAppleSilicon: boolean;
  gpu: GpuInfo | null;
  freeDiskBytes: number;
  tier: HardwareTier;
  tierReason: string;
}

export interface CatalogModel {
  id: string; displayName: string; repo: string; file: string; quant: string;
  sizeBytes: number; sha256: string; license: string; revision?: string; contextLength: number;
  tier: HardwareTier; roles: string[];
}
export interface Catalog { schemaVersion: number; models: CatalogModel[]; }
export type DownloadPhase = "downloading" | "verifying" | "done" | "error";
export interface DownloadProgress { modelId: string; downloadedBytes: number; totalBytes: number; phase: DownloadPhase; error?: string; }

export type Mode = "ask" | "plan" | "agent";

export type InferencePhase = "planning" | "edit-gen" | "validation";

export type AgentStepKind = "plan" | "read" | "search_replace" | "terminal" | "finish";

export type AgentStepStatus = "ok" | "retried" | "failed" | "aborted";

export interface AgentStep {
  index: number;
  kind: AgentStepKind;
  payload: unknown;
  startedAt: number;
  endedAt: number;
  phase: InferencePhase;
  tokensIn: number;
  tokensOut: number;
  status: AgentStepStatus;
}

export interface SearchReplaceBlock {
  file: string;
  search: string;
  replace: string;
  astNode?: string;
}

export interface DiffValidationResult {
  syntaxOk: boolean;
  errors: string[];
}

export interface StagedDiff {
  id: string;
  taskId: string;
  blocks: SearchReplaceBlock[];
  validation: DiffValidationResult;
  createdAt: number;
  status: "pending" | "applied" | "rejected" | "partial";
}

export type ProFeatureKey =
  | "modelLab"
  | "manualPin"
  | "perfTuning"
  | "byokFallback"
  | "teamPolicy"
  | "diagnosticBundle";

export interface Entitlement {
  tier: "free" | "pro";
  plan: "none" | "annual" | "monthly" | "team";
  expiresAt: number | null;
  offlineGraceUntil: number;
  features: Record<ProFeatureKey, boolean>;
}

export type SecurityAction = "allow" | "deny" | "confirm";

export interface SecurityDecision {
  action: SecurityAction;
  reason: string;
  ruleId: string;
}
