import path from "node:path";
import fs from "node:fs";
import { getLlama, LlamaChatSession, type Llama, type LlamaModel, type LlamaContext } from "node-llama-cpp";
import { defaultModelsDir, verifyModel } from "./catalog.js";
import type { InferencePhase } from "../shared/types.js";

export interface CompletionResult { text: string; tokensIn: number; tokensOut: number; msPlanning: number; msEditGen: number; }
export interface StreamHandle { streamId: string; abort: () => void; }
interface Loaded { model: LlamaModel; context: LlamaContext; }
let llama: Promise<Llama> | null = null;
const loaded = new Map<string, Loaded>();
let sequence = 0;
async function getRuntime(): Promise<Llama> { llama ??= getLlama({ gpu: "auto" }); return llama; }
export async function loadModel(modelId: string): Promise<LlamaModel> { if (!/^[a-z0-9.-]+$/.test(modelId)) throw new Error("Invalid model id"); const cached = loaded.get(modelId); if (cached) return cached.model; const file = path.join(defaultModelsDir(), `${modelId}.gguf`); if (!fs.existsSync(file)) throw new Error(`Model file missing on disk: ${file}. Download it first.`); if (!(await verifyModel(modelId))) throw new Error(`Model checksum is invalid: ${modelId}. Re-download it before use.`); const model = await (await getRuntime()).loadModel({ modelPath: file }); const context = await model.createContext({ contextSize: 8192 }); loaded.set(modelId, { model, context }); return model; }
export async function unloadModel(modelId: string): Promise<void> { const item = loaded.get(modelId); if (!item) return; await item.context.dispose(); await item.model.dispose(); loaded.delete(modelId); }
export function startStream(options: { modelId: string; systemPrompt: string; userMessage: string; context: string; phase: InferencePhase; maxTokens?: number; onToken: (text: string) => void; onEnd: (result: CompletionResult) => void; onError: (error: Error) => void }): StreamHandle {
  const streamId = `stream-${++sequence}`; const controller = new AbortController();
  void (async () => { const started = Date.now(); try { await loadModel(options.modelId); const item = loaded.get(options.modelId); if (!item) throw new Error("Model context unavailable"); const seq = item.context.getSequence(); try { const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: options.systemPrompt.replace("{{context}}", options.context) }); let text = ""; const response = await session.prompt(options.userMessage, { signal: controller.signal, maxTokens: options.maxTokens ?? 768, onTextChunk: (chunk: string) => { if (!controller.signal.aborted) { text += chunk; options.onToken(chunk); } } }); if (controller.signal.aborted) return; const meter = seq.tokenMeter.getState(); options.onEnd({ text: text || response, tokensIn: meter.usedInputTokens ?? 0, tokensOut: meter.usedOutputTokens ?? 0, msPlanning: options.phase === "planning" ? Date.now() - started : 0, msEditGen: options.phase === "edit-gen" ? Date.now() - started : 0 }); } finally { await seq.dispose(); } } catch (error) { if (!controller.signal.aborted) options.onError(error instanceof Error ? error : new Error(String(error))); } })();
  return { streamId, abort: () => controller.abort() };
}
