import { ipcMain } from "electron";
import crypto from "node:crypto";
import { CH } from "./channels.js";
import { startStream, loadModel, type StreamHandle } from "../../core/inference.js";
import { AGENT_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from "../../core/prompts.js";
import { route } from "../../core/router.js";
import { chooseModel } from "../../core/router.js";
import { detectHardware } from "../../core/hardware.js";
import { readBundledCatalog } from "../../core/catalog.js";
import type { CompletionResult } from "../../core/inference.js";
import { runAgent } from "../../core/agent.js";
import { classifyPath } from "../../core/security.js";
const active = new Map<string, StreamHandle>();
export function registerInferenceIpc(): void {
  ipcMain.handle(CH.INFER_ROUTE, async (_event, payload: { input: string; mode?: "ask" | "plan" | "agent" }) => {
    const hardware = await detectHardware();
    return chooseModel(payload.input, hardware.tier, readBundledCatalog().models, payload.mode);
  });
  ipcMain.handle(CH.INFER_LOAD, async (_event, modelId: string) => { await loadModel(modelId); return { ok: true }; });
  ipcMain.handle(CH.INFER_STREAM_START, (event, payload: { input: string; modelId: string; mode?: "ask" | "plan" | "agent"; context?: string }) => {
    const mode = route(payload.input, 2, payload.mode);
    const systemPrompt = mode === "agent" ? AGENT_SYSTEM_PROMPT : mode === "plan" ? PLAN_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT;
    const streamKey = crypto.randomUUID(); const sender = event.sender;
    const emitEnd = (result: CompletionResult, error?: string) => { if (!sender.isDestroyed()) sender.send(CH.INFER_STREAM_END, { streamKey, result, error }); active.delete(streamKey); };
    const handle = startStream({ modelId: payload.modelId, systemPrompt, userMessage: payload.input, context: payload.context ?? "", phase: mode === "ask" ? "planning" : "edit-gen", onToken: (text) => { if (!sender.isDestroyed()) sender.send(CH.INFER_STREAM_TOKEN, { streamKey, text }); }, onEnd: (result) => emitEnd(result), onError: (error) => emitEnd({ text: "", tokensIn: 0, tokensOut: 0, msPlanning: 0, msEditGen: 0 }, error.message) }); active.set(streamKey, handle); return { streamKey };
  });
  ipcMain.handle(CH.INFER_STREAM_CANCEL, (_event, streamKey: string) => { const handle = active.get(streamKey); if (!handle) return { aborted: false }; handle.abort(); return { aborted: true }; });
  ipcMain.handle(CH.AGENT_RUN, async (_event, payload: { plan: import("../../core/agent.js").AgentPlanStep[]; workspaceRoot: string; allowWrites: boolean }) => {
    if (!payload.workspaceRoot || !Array.isArray(payload.plan)) throw new Error("Invalid agent request");
    for (const item of payload.plan) {
      if (item.kind !== "search_replace") continue;
      const file = (item.payload as { file?: unknown }).file;
      if (typeof file !== "string") throw new Error("Agent edit is missing a file");
      const decision = classifyPath(file, "write", { workspaceRoot: payload.workspaceRoot });
      if (decision.action !== "allow") throw new Error(`Agent write blocked: ${decision.reason}`);
    }
    return runAgent(payload.plan, { workspaceRoot: payload.workspaceRoot, maxSteps: 32, maxFiles: 8, timeoutMs: 300_000, allowWrites: payload.allowWrites });
  });
}
