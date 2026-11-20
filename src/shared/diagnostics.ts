import type { HardwareProfile, AgentStep, Entitlement } from "./types";

export interface CachedModelInfo {
  id: string;
  quant: string;
  sha256Prefix: string;
  sizeBytes: number;
  verified: boolean;
}

export interface DiagnosticReport {
  generatedAt: number;
  appVersion: string;
  appCommit: string;
  os: string;
  arch: string;
  hardware: HardwareProfile;
  cachedModels: CachedModelInfo[];
  activeModelId: string | null;
  entitlement: Entitlement;
  securityRulesetHash: string;
  freeDiskBytes: number;
  recentLogLines: string[];
  recentAgentSteps: AgentStep[];
}
