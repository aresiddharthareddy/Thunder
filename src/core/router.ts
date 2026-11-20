import type { CatalogModel, HardwareTier, Mode } from "../shared/types.js";

export interface RouteDecision {
  mode: Mode;
  modelId: string | null;
  reason: string;
  confidence: number;
}

const agentSignals = /\b(edit|fix|implement|refactor|rename|create|delete|add|remove|update|build|run tests?|make changes?)\b/i;
const planSignals = /\b(plan|design|architecture|steps?|approach|how should|break down)\b/i;
function supportsMode(model: CatalogModel, mode: Mode): boolean {
  // Older catalog entries call Agent-capable editing models "edit".
  return model.roles.includes(mode) || (mode === "agent" && model.roles.includes("edit")) || model.roles.includes("router");
}

export function route(input: string, tier: number, explicitMode?: Mode): Mode {
  if (explicitMode) return explicitMode;
  if (tier >= 2 && agentSignals.test(input)) return "agent";
  if (planSignals.test(input)) return "plan";
  return "ask";
}

export function chooseModel(input: string, tier: HardwareTier, models: CatalogModel[], explicitMode?: Mode): RouteDecision {
  const mode = route(input, tier, explicitMode);
  const candidates = models.filter((model) => model.tier <= tier && supportsMode(model, mode));
  const ranked = [...candidates].sort((a, b) => {
    const aMode = supportsMode(a, mode) && a.roles.includes(mode) ? 1 : 0;
    const bMode = supportsMode(b, mode) && b.roles.includes(mode) ? 1 : 0;
    return bMode - aMode || a.sizeBytes - b.sizeBytes;
  });
  const selected = ranked[0] ?? null;
  return {
    mode,
    modelId: selected?.id ?? null,
    reason: selected ? `${mode} routed to ${selected.displayName} for tier ${tier}` : "No compatible local model is installed",
    confidence: explicitMode ? 1 : mode === "ask" ? 0.7 : 0.85
  };
}
