import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { AgentStep, AgentStepKind, AgentStepStatus, SearchReplaceBlock } from "../shared/types.js";

export interface AgentPolicy {
  workspaceRoot: string;
  maxSteps: number;
  maxFiles: number;
  timeoutMs: number;
  allowWrites: boolean;
}

export interface AgentPlanStep { kind: AgentStepKind; payload: unknown; }
export interface AgentRunResult { taskId: string; status: "completed" | "failed" | "aborted"; steps: AgentStep[]; changedFiles: string[]; error?: string; }

function safePath(root: string, file: string): string {
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${file}`);
  return resolved;
}

function applyBlock(content: string, block: SearchReplaceBlock): string {
  const occurrences = content.split(block.search).length - 1;
  if (occurrences !== 1) throw new Error(`Expected exactly one match in ${block.file}, found ${occurrences}`);
  return content.replace(block.search, block.replace);
}

export async function runAgent(plan: AgentPlanStep[], policy: AgentPolicy, signal?: AbortSignal, onStep?: (step: AgentStep) => void): Promise<AgentRunResult> {
  const taskId = crypto.randomUUID();
  const started = Date.now();
  const steps: AgentStep[] = [];
  const changed = new Set<string>();
  const finish = (index: number, kind: AgentStepKind, payload: unknown, status: AgentStepStatus, stepStarted: number, error?: string) => {
    const step: AgentStep = { index, kind, payload: error ? { payload, error } : payload, startedAt: stepStarted, endedAt: Date.now(), phase: kind === "plan" ? "planning" : kind === "finish" ? "validation" : "edit-gen", tokensIn: 0, tokensOut: 0, status };
    steps.push(step); onStep?.(step);
  };
  try {
    if (plan.length > policy.maxSteps) throw new Error(`Agent plan exceeds ${policy.maxSteps} steps`);
    for (let index = 0; index < plan.length; index += 1) {
      if (signal?.aborted) return { taskId, status: "aborted", steps, changedFiles: [...changed] };
      if (Date.now() - started > policy.timeoutMs) throw new Error("Agent timeout exceeded");
      const item = plan[index]; const stepStarted = Date.now();
      if (item.kind === "read") {
        const file = safePath(policy.workspaceRoot, String((item.payload as { file: string }).file));
        await fs.readFile(file, "utf8"); finish(index, item.kind, item.payload, "ok", stepStarted); continue;
      }
      if (item.kind === "search_replace") {
        if (!policy.allowWrites) throw new Error("Agent writes are disabled by policy");
        const block = item.payload as SearchReplaceBlock;
        if (changed.size >= policy.maxFiles && !changed.has(block.file)) throw new Error(`Agent file budget exceeded: ${policy.maxFiles}`);
        const file = safePath(policy.workspaceRoot, block.file); const content = await fs.readFile(file, "utf8");
        await fs.writeFile(file, applyBlock(content, block)); changed.add(block.file); finish(index, item.kind, block, "ok", stepStarted); continue;
      }
      if (item.kind === "plan" || item.kind === "finish") { finish(index, item.kind, item.payload, "ok", stepStarted); continue; }
      throw new Error(`Unsupported agent step: ${item.kind}`);
    }
    return { taskId, status: "completed", steps, changedFiles: [...changed] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const last = plan[steps.length]; if (last) finish(steps.length, last.kind, last.payload, signal?.aborted ? "aborted" : "failed", Date.now(), message);
    return { taskId, status: signal?.aborted ? "aborted" : "failed", steps, changedFiles: [...changed], error: message };
  }
}
