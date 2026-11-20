import { ipcMain } from "electron";
import crypto from "node:crypto";
import { CH } from "./channels.js";
import { startStream, loadModel, type StreamHandle } from "../../core/inference.js";
import { AGENT_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from "../../core/prompts.js";
import { route } from "../../core/router.js";
import { chooseModel } from "../../core/router.js";
import { capabilitiesFor, detectHardware } from "../../core/hardware.js";
import { defaultModelsDir, readBundledCatalog } from "../../core/catalog.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { CompletionResult } from "../../core/inference.js";
import { runAgent } from "../../core/agent.js";
import { classifyPath, redactSecrets } from "../../core/security.js";
import { db } from "../db/index.js";
const active = new Map<string, StreamHandle>();
export function registerInferenceIpc(): void {
  ipcMain.handle(CH.INFER_ROUTE, async (_event, payload: { input: string; mode?: "ask" | "plan" | "agent" }) => {
    const hardware = await detectHardware();
    const catalog = readBundledCatalog();
    const available = (await Promise.all(catalog.models.map(async (model) => { try { await fs.access(path.join(defaultModelsDir(), `${model.id}.gguf`)); return model; } catch { return null; } }))).filter((model): model is typeof catalog.models[number] => model !== null);
    return chooseModel(payload.input, hardware.tier, available, payload.mode);
  });
  ipcMain.handle(CH.INFER_LOAD, async (_event, modelId: string) => { await loadModel(modelId); return { ok: true }; });
  ipcMain.handle(CH.INFER_STREAM_START, async (event, payload: { input: string; modelId: string; mode?: "ask" | "plan" | "agent"; context?: string }) => {
    const mode = route(payload.input, (await detectHardware()).tier, payload.mode);
    const systemPrompt = mode === "agent" ? AGENT_SYSTEM_PROMPT : mode === "plan" ? PLAN_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT;
    const streamKey = crypto.randomUUID(); const sender = event.sender;
    const emitEnd = (result: CompletionResult, error?: string) => { if (!sender.isDestroyed()) sender.send(CH.INFER_STREAM_END, { streamKey, result, error }); active.delete(streamKey); };
    const safeContext = (await redactSecrets(payload.context ?? "")).text;
    const handle = startStream({ modelId: payload.modelId, systemPrompt, userMessage: payload.input, context: safeContext, phase: mode === "ask" ? "planning" : "edit-gen", maxTokens: mode === "agent" ? 1024 : mode === "plan" ? 768 : 512, onToken: (text) => { if (!sender.isDestroyed()) sender.send(CH.INFER_STREAM_TOKEN, { streamKey, text }); }, onEnd: (result) => emitEnd(result), onError: (error) => emitEnd({ text: "", tokensIn: 0, tokensOut: 0, msPlanning: 0, msEditGen: 0 }, error.message) }); active.set(streamKey, handle); return { streamKey };
  });
  ipcMain.handle(CH.INFER_STREAM_CANCEL, (_event, streamKey: string) => { const handle = active.get(streamKey); if (!handle) return { aborted: false }; handle.abort(); return { aborted: true }; });
  ipcMain.handle(CH.AGENT_RUN, async (_event, payload: { plan: import("../../core/agent.js").AgentPlanStep[]; workspaceRoot: string; allowWrites: boolean }) => {
    if (!payload.workspaceRoot || !Array.isArray(payload.plan)) throw new Error("Invalid agent request");
    const hardware = await detectHardware(); const capabilities = capabilitiesFor(hardware.tier);
    if (!capabilities.modes.includes("agent")) throw new Error(`Agent mode is unavailable on hardware tier ${hardware.tier}`);
    for (const item of payload.plan) {
      if (item.kind !== "search_replace") continue;
      const file = (item.payload as { file?: unknown }).file;
      if (typeof file !== "string") throw new Error("Agent edit is missing a file");
      const decision = classifyPath(file, "write", { workspaceRoot: payload.workspaceRoot });
      if (decision.action !== "allow") throw new Error(`Agent write blocked: ${decision.reason}`);
    }
    const persistedSteps: import("../../shared/types.js").AgentStep[] = [];
    const result = await runAgent(
      payload.plan,
      { workspaceRoot: payload.workspaceRoot, maxSteps: Math.max(8, capabilities.maxFilesPerAgentRun * 4), maxFiles: capabilities.maxFilesPerAgentRun, timeoutMs: capabilities.agentStepTimeoutMs, allowWrites: payload.allowWrites },
      undefined,
      (step) => { persistedSteps.push(step); },
    );
    for (const step of persistedSteps) {
      const payloadValue = step.payload && typeof step.payload === "object" ? step.payload as Record<string, unknown> : {};
      const safePayload = { kind: step.kind, file: typeof payloadValue.file === "string" ? payloadValue.file : undefined, error: typeof payloadValue.error === "string" ? payloadValue.error : undefined };
      db.prepare("INSERT INTO agent_steps (task_id, step_index, kind, payload_json, phase, started_at, ended_at, tokens_in, tokens_out, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(result.taskId, step.index, step.kind, JSON.stringify(safePayload), step.phase, step.startedAt, step.endedAt, step.tokensIn, step.tokensOut, step.status);
    }
    db.prepare("INSERT INTO audit_log (ts, event, detail_json) VALUES (?, ?, ?)").run(Date.now(), "agent.run", JSON.stringify({ taskId: result.taskId, status: result.status, changedFiles: result.changedFiles, error: result.error ?? null }));
    return result;
  });
}
