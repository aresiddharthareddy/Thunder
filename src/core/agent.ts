import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import ts from "typescript";
import type { AgentStep, AgentStepKind, AgentStepStatus, SearchReplaceBlock } from "../shared/types.js";

export interface AgentPolicy {
  workspaceRoot: string;
  maxSteps: number;
  maxFiles: number;
  timeoutMs: number;
  allowWrites: boolean;
  maxReadBytes?: number;
}

export interface AgentPlanStep { kind: AgentStepKind; payload: unknown; }
export interface AgentRunResult { taskId: string; status: "completed" | "failed" | "aborted"; steps: AgentStep[]; changedFiles: string[]; error?: string; }

export function parseAgentPlan(text: string): AgentPlanStep[] {
  const candidate = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate.trim()); } catch { throw new Error("Agent returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { steps?: unknown }).steps)) throw new Error("Agent response must contain a steps array");
  return (parsed as { steps: unknown[] }).steps.map((item, index) => {
    if (!item || typeof item !== "object" || typeof (item as { kind?: unknown }).kind !== "string" || !("payload" in item)) throw new Error(`Invalid agent step ${index + 1}`);
    const kind = (item as unknown as { kind: string }).kind;
    if (!["plan", "read", "search_replace", "finish"].includes(kind)) throw new Error(`Unsupported agent step ${index + 1}: ${kind}`);
    const payload = (item as { payload: unknown }).payload;
    if ((kind === "read" || kind === "search_replace") && (!payload || typeof payload !== "object" || typeof (payload as { file?: unknown }).file !== "string" || path.isAbsolute((payload as { file: string }).file))) throw new Error(`Unsafe path in agent step ${index + 1}`);
    if (kind === "search_replace" && (typeof (payload as { search?: unknown }).search !== "string" || typeof (payload as { replace?: unknown }).replace !== "string")) throw new Error(`Invalid replacement in agent step ${index + 1}`);
    return { kind: kind as AgentStepKind, payload };
  });
}

function safePath(root: string, file: string): string {
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes workspace: ${file}`);
  return resolved;
}

async function safeExistingPath(root: string, file: string): Promise<string> {
  const resolved = safePath(root, file);
  const canonicalRoot = await fs.realpath(root);
  const canonical = await fs.realpath(resolved);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error(`Path escapes workspace through symlink: ${file}`);
  return canonical;
}

function applyBlock(content: string, block: SearchReplaceBlock): string {
  const occurrences = content.split(block.search).length - 1;
  if (occurrences !== 1) throw new Error(`Expected exactly one match in ${block.file}, found ${occurrences}`);
  return content.replace(block.search, block.replace);
}

function validateSyntax(file: string, content: string): void {
  if (/\.json$/i.test(file)) {
    JSON.parse(content);
    return;
  }
  if (!/\.[cm]?[jt]sx?$/i.test(file)) return;
  const result = ts.transpileModule(content, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const diagnostic = result.diagnostics?.[0];
  if (diagnostic) throw new Error(`Syntax check failed for ${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\\n")}`);
}

export async function runAgent(plan: AgentPlanStep[], policy: AgentPolicy, signal?: AbortSignal, onStep?: (step: AgentStep) => void): Promise<AgentRunResult> {
  const taskId = crypto.randomUUID();
  const started = Date.now();
  const steps: AgentStep[] = [];
  const changed = new Set<string>();
  const originals = new Map<string, string>();
  const rollback = async (): Promise<void> => { await Promise.all([...originals.entries()].map(async ([file, content]) => fs.writeFile(file, content))); };
  const finish = (index: number, kind: AgentStepKind, payload: unknown, status: AgentStepStatus, stepStarted: number, error?: string) => {
    const step: AgentStep = { index, kind, payload: error ? { payload, error } : payload, startedAt: stepStarted, endedAt: Date.now(), phase: kind === "plan" ? "planning" : kind === "finish" ? "validation" : "edit-gen", tokensIn: 0, tokensOut: 0, status };
    steps.push(step); onStep?.(step);
  };
  try {
    if (plan.length > policy.maxSteps) throw new Error(`Agent plan exceeds ${policy.maxSteps} steps`);
    for (let index = 0; index < plan.length; index += 1) {
      if (signal?.aborted) { await rollback(); return { taskId, status: "aborted", steps, changedFiles: [] }; }
      if (Date.now() - started > policy.timeoutMs) throw new Error("Agent timeout exceeded");
      const item = plan[index]; const stepStarted = Date.now();
      if (item.kind === "read") {
        const file = await safeExistingPath(policy.workspaceRoot, String((item.payload as { file: string }).file));
        const stat = await fs.stat(file); const maxReadBytes = policy.maxReadBytes ?? 1_048_576;
        if (stat.size > maxReadBytes) throw new Error(`Read exceeds ${maxReadBytes} bytes: ${(item.payload as { file: string }).file}`);
        const content = await fs.readFile(file, "utf8"); finish(index, item.kind, { ...(item.payload as object), content }, "ok", stepStarted); continue;
      }
      if (item.kind === "search_replace") {
        if (!policy.allowWrites) throw new Error("Agent writes are disabled by policy");
        const block = item.payload as SearchReplaceBlock;
        if (changed.size >= policy.maxFiles && !changed.has(block.file)) throw new Error(`Agent file budget exceeded: ${policy.maxFiles}`);
        const file = await safeExistingPath(policy.workspaceRoot, block.file); const content = await fs.readFile(file, "utf8");
        if (!originals.has(file)) originals.set(file, content);
        const next = applyBlock(content, block);
        validateSyntax(block.file, next);
        await fs.writeFile(file, next); changed.add(block.file); finish(index, item.kind, block, "ok", stepStarted); continue;
      }
      if (item.kind === "plan" || item.kind === "finish") { finish(index, item.kind, item.payload, "ok", stepStarted); continue; }
      throw new Error(`Unsupported agent step: ${item.kind}`);
    }
    return { taskId, status: "completed", steps, changedFiles: [...changed] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await rollback();
    const last = plan[steps.length]; if (last) finish(steps.length, last.kind, last.payload, signal?.aborted ? "aborted" : "failed", Date.now(), message);
    return { taskId, status: signal?.aborted ? "aborted" : "failed", steps, changedFiles: [], error: message };
  }
}
