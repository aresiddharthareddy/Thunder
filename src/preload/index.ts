import { contextBridge, ipcRenderer } from "electron";
import { CH } from "../main/ipc/channels.js";
import type { HardwareProfile, HardwareTier } from "../shared/types.js";
import type { DiagnosticReport } from "../shared/diagnostics.js";
import type { TierCapabilities } from "../core/hardware.js";
import type { CatalogModel, DownloadProgress, Mode } from "../shared/types.js";
import type { CompletionResult } from "../core/inference.js";
import type { AgentPlanStep, AgentRunResult } from "../core/agent.js";

const api = {
  hardware: {
    detect: (): Promise<HardwareProfile> =>
      ipcRenderer.invoke(CH.HARDWARE_DETECT) as Promise<HardwareProfile>,
    capabilities: (tier: HardwareTier): Promise<TierCapabilities> =>
      ipcRenderer.invoke(CH.HARDWARE_CAPABILITIES, tier) as Promise<TierCapabilities>,
  },
  doctor: {
    collect: (): Promise<DiagnosticReport> =>
      ipcRenderer.invoke(CH.DOCTOR_COLLECT) as Promise<DiagnosticReport>,
    save: (): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(CH.DOCTOR_SAVE) as Promise<{ saved: boolean; path?: string }>,
  },
  catalog: {
    list: (): Promise<Array<CatalogModel & { downloaded: boolean }>> =>
      ipcRenderer.invoke(CH.CATALOG_LIST) as Promise<Array<CatalogModel & { downloaded: boolean }>>,
    downloadStart: (modelId: string): Promise<{ ok: boolean; path: string }> =>
      ipcRenderer.invoke(CH.CATALOG_DOWNLOAD_START, modelId) as Promise<{ ok: boolean; path: string }>,
    downloadCancel: (modelId: string): Promise<{ aborted: boolean }> =>
      ipcRenderer.invoke(CH.CATALOG_DOWNLOAD_CANCEL, modelId) as Promise<{ aborted: boolean }>,
    verify: (modelId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CH.CATALOG_VERIFY, modelId) as Promise<{ ok: boolean }>,
    onProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void => callback(progress);
      ipcRenderer.on(CH.CATALOG_DOWNLOAD_PROGRESS, handler);
      return () => ipcRenderer.removeListener(CH.CATALOG_DOWNLOAD_PROGRESS, handler);
    },
  },
  inference: {
    route: (payload: { input: string; mode?: Mode }): Promise<{ mode: Mode; modelId: string | null; reason: string; confidence: number }> => ipcRenderer.invoke(CH.INFER_ROUTE, payload) as Promise<{ mode: Mode; modelId: string | null; reason: string; confidence: number }>,
    load: (modelId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(CH.INFER_LOAD, modelId) as Promise<{ ok: boolean }>,
    streamStart: (payload: { input: string; modelId: string; mode?: Mode; context?: string }): Promise<{ streamKey: string }> => ipcRenderer.invoke(CH.INFER_STREAM_START, payload) as Promise<{ streamKey: string }>,
    streamCancel: (streamKey: string): Promise<{ aborted: boolean }> => ipcRenderer.invoke(CH.INFER_STREAM_CANCEL, streamKey) as Promise<{ aborted: boolean }>,
    onToken: (callback: (payload: { streamKey: string; text: string }) => void): (() => void) => { const handler = (_event: Electron.IpcRendererEvent, payload: { streamKey: string; text: string }) => callback(payload); ipcRenderer.on(CH.INFER_STREAM_TOKEN, handler); return () => ipcRenderer.removeListener(CH.INFER_STREAM_TOKEN, handler); },
    onEnd: (callback: (payload: { streamKey: string; result: CompletionResult; error?: string }) => void): (() => void) => { const handler = (_event: Electron.IpcRendererEvent, payload: { streamKey: string; result: CompletionResult; error?: string }) => callback(payload); ipcRenderer.on(CH.INFER_STREAM_END, handler); return () => ipcRenderer.removeListener(CH.INFER_STREAM_END, handler); },
  },
  agent: {
    run: (payload: { plan: AgentPlanStep[]; workspaceRoot: string; allowWrites: boolean }): Promise<AgentRunResult> => ipcRenderer.invoke(CH.AGENT_RUN, payload) as Promise<AgentRunResult>,
  },
  security: {
    classifyPath: (payload: { targetPath: string; intent: "read" | "write"; workspaceRoot: string }) => ipcRenderer.invoke(CH.SECURITY_CLASSIFY_PATH, payload),
    redactSecrets: (text: string) => ipcRenderer.invoke(CH.SECURITY_REDACT, text),
    rulesetHash: (): Promise<string> => ipcRenderer.invoke(CH.SECURITY_HASH) as Promise<string>,
  },
  files: {
    open: (): Promise<{ filePath: string; workspaceRoot: string; content: string } | null> => ipcRenderer.invoke(CH.FILE_OPEN) as Promise<{ filePath: string; workspaceRoot: string; content: string } | null>,
    read: (payload: { filePath: string; workspaceRoot: string }): Promise<string> => ipcRenderer.invoke(CH.FILE_READ, payload) as Promise<string>,
    tree: (workspaceRoot: string): Promise<string[]> => ipcRenderer.invoke(CH.FILE_TREE, { workspaceRoot }) as Promise<string[]>,
    write: (payload: { filePath: string; workspaceRoot: string; content: string }): Promise<{ ok: boolean }> => ipcRenderer.invoke(CH.FILE_WRITE, payload) as Promise<{ ok: boolean }>,
  },
  chat: {
    createSession: (payload: { mode: Mode; title?: string }): Promise<{ id: string }> => ipcRenderer.invoke(CH.CHAT_SESSION_CREATE, payload) as Promise<{ id: string }>,
    latest: (payload: { mode: Mode }): Promise<{ id: string; title: string; mode: Mode; messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> } | null> => ipcRenderer.invoke(CH.CHAT_SESSION_LATEST, payload) as Promise<{ id: string; title: string; mode: Mode; messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> } | null>,
    append: (payload: { sessionId: string; role: "user" | "assistant" | "system" | "tool"; content: string }): Promise<{ id: string }> => ipcRenderer.invoke(CH.CHAT_MESSAGE_APPEND, payload) as Promise<{ id: string }>,
  },
};

contextBridge.exposeInMainWorld("thunder", api);

export type ThunderApi = typeof api;
