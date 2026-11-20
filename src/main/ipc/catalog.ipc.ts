import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { db } from "../db/index.js";
import { defaultModelsDir, downloadModel, loadCatalog, verifyModel } from "../../core/catalog.js";
import type { DownloadProgress } from "../../shared/types.js";
import { readEntitlement } from "../entitlement.js";
const active = new Map<string, AbortController>();
export function registerCatalogIpc(): void {
  ipcMain.handle(CH.CATALOG_LIST, async () => {
    const catalog = await loadCatalog();
    const rows = db.prepare("SELECT model_id, verified FROM model_registry").all() as Array<{ model_id: string; verified: number }>;
    const registered = new Set(rows.filter((row) => row.verified === 1).map((row) => row.model_id));
    const verified = new Set((await Promise.all([...registered].map(async (modelId) => (await verifyModel(modelId)) ? modelId : null))).filter((modelId): modelId is string => modelId !== null));
    return catalog.models.map((model) => ({ ...model, downloaded: verified.has(model.id) }));
  });
  ipcMain.handle(CH.CATALOG_DOWNLOAD_START, async (event, modelId: string) => {
    if (active.has(modelId)) throw new Error(`Download already in progress: ${modelId}`);
    const controller = new AbortController();
    active.set(modelId, controller);
    const send = (progress: DownloadProgress) => {
      if (!event.sender.isDestroyed()) event.sender.send(CH.CATALOG_DOWNLOAD_PROGRESS, progress);
    };
    try {
      const model = (await loadCatalog()).models.find((item) => item.id === modelId);
      if (!model) throw new Error(`Unknown model: ${modelId}`);
      if (readEntitlement().tier === "free" && (!["Apache-2.0", "MIT"].includes(model.license) || model.sizeBytes > 2_000_000_000)) {
        throw new Error("Free Auto mode only downloads verified models up to 2 GB.");
      }
      const localPath = await downloadModel(modelId, { signal: controller.signal, modelsDir: defaultModelsDir(), onProgress: send });
      db.prepare("INSERT OR REPLACE INTO model_registry (model_id, quant, sha256, size_bytes, local_path, downloaded_at, verified) VALUES (?, ?, ?, ?, ?, ?, 1)")
        .run(model.id, model.quant, model.sha256, model.sizeBytes, localPath, Date.now());
      return { ok: true, path: localPath };
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (!aborted) send({ modelId, downloadedBytes: 0, totalBytes: 0, phase: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      active.delete(modelId);
    }
  });
  ipcMain.handle(CH.CATALOG_DOWNLOAD_CANCEL, (_event, modelId: string) => { const controller = active.get(modelId); if (controller) controller.abort(); return { aborted: Boolean(controller) }; });
  ipcMain.handle(CH.CATALOG_VERIFY, async (_event, modelId: string) => ({ ok: await verifyModel(modelId) }));
}
