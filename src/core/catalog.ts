import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import type { Catalog, CatalogModel, DownloadProgress } from "../shared/types.js";
import { assertNoOutbound } from "./security.js";

const ModelSchema = z.object({ id: z.string().min(1), displayName: z.string().min(1), repo: z.string().min(1), file: z.string().min(1), quant: z.string().min(1), sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/i), license: z.string().min(1), revision: z.string().min(1).optional(), contextLength: z.number().int().positive(), tier: z.union([z.literal(1), z.literal(2), z.literal(2.5), z.literal(3)]), roles: z.array(z.string()) });
const CatalogSchema = z.object({ schemaVersion: z.number().int(), models: z.array(ModelSchema) });
function bundledPath(): string { return app.isPackaged ? path.join(process.resourcesPath, "models.json") : path.join(app.getAppPath(), "resources", "models.json"); }
export function defaultModelsDir(): string { return path.join(app.getPath("userData"), "models"); }
export function readBundledCatalog(): Catalog { return CatalogSchema.parse(JSON.parse(fs.readFileSync(bundledPath(), "utf8"))) as Catalog; }
const CATALOG_URL = "https://thunder-models.pages.dev/models.json";
export function mergeCatalog(bundled: Catalog, remote: Catalog): Catalog {
  const remoteById = new Map(remote.models.map((model) => [model.id, model]));
  const models = bundled.models.map((pinned) => {
    const candidate = remoteById.get(pinned.id);
    if (!candidate) return pinned;
    // Remote data may improve presentation metadata, but never changes the
    // pinned binary identity or execution policy of a bundled model.
    return { ...pinned, displayName: candidate.displayName };
  });
  return { schemaVersion: bundled.schemaVersion, models };
}
export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<Catalog> {
  const bundled = readBundledCatalog();
  try {
    assertNoOutbound("catalog-override");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetchImpl(CATALOG_URL, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) return bundled;
      const remote = CatalogSchema.parse(await response.json()) as Catalog;
      return mergeCatalog(bundled, remote);
    } finally { clearTimeout(timeout); }
  } catch { return bundled; }
}
export function findModel(catalog: Catalog, id: string): CatalogModel { const model = catalog.models.find((item) => item.id === id); if (!model) throw new Error(`Unknown model id: ${id}`); return model; }
async function exists(file: string): Promise<boolean> { try { await fsp.access(file); return true; } catch { return false; } }
async function size(file: string): Promise<number> { try { return (await fsp.stat(file)).size; } catch { return -1; } }
async function hash(file: string): Promise<string> { return new Promise((resolve, reject) => { const h = crypto.createHash("sha256"); const stream = fs.createReadStream(file); stream.on("data", (chunk) => h.update(chunk)); stream.on("end", () => resolve(h.digest("hex"))); stream.on("error", reject); }); }
export interface DownloadOptions { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void; modelsDir?: string; fetchImpl?: typeof fetch; }
export async function downloadModel(modelId: string, options: DownloadOptions = {}): Promise<string> {
  assertNoOutbound(`downloadModel:${modelId}`);
  const model = findModel(await loadCatalog(), modelId); const dir = options.modelsDir ?? defaultModelsDir(); await fsp.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${model.id}.gguf`); const partialPath = `${finalPath}.partial`;
  if (await exists(finalPath) && (await hash(finalPath)) === model.sha256.toLowerCase()) { options.onProgress?.({ modelId, downloadedBytes: model.sizeBytes, totalBytes: model.sizeBytes, phase: "done" }); return finalPath; }
  if (await exists(finalPath)) await fsp.unlink(finalPath).catch(() => undefined);
  let start = Math.max(0, await size(partialPath)); const headers: Record<string, string> = {}; if (start > 0) headers.Range = `bytes=${start}-`;
  const response = await (options.fetchImpl ?? fetch)(`https://huggingface.co/${model.repo}/resolve/${model.revision ?? "main"}/${model.file}`, { headers, signal: options.signal, redirect: "follow" });
  if (response.status === 416) { await fsp.unlink(partialPath).catch(() => undefined); return downloadModel(modelId, options); }
  if (!response.ok && response.status !== 206) throw new Error(`Download failed: HTTP ${response.status}`);
  if (start > 0 && response.status === 200) { await fsp.unlink(partialPath).catch(() => undefined); start = 0; }
  if (!response.body) throw new Error("Response body missing");
  const writer = fs.createWriteStream(partialPath, { flags: start > 0 ? "a" : "w" }); let downloaded = start;
  options.onProgress?.({ modelId, downloadedBytes: downloaded, totalBytes: model.sizeBytes, phase: "downloading" });
  const reader = response.body.getReader();
  try { while (true) { const item = await reader.read(); if (item.done) break; if (options.signal?.aborted) throw new DOMException("aborted", "AbortError"); downloaded += item.value.byteLength; if (downloaded > model.sizeBytes + 1_048_576) throw new Error(`Download exceeds catalogued size for ${modelId}`); await new Promise<void>((resolve, reject) => writer.write(Buffer.from(item.value), (error) => error ? reject(error) : resolve())); options.onProgress?.({ modelId, downloadedBytes: downloaded, totalBytes: model.sizeBytes, phase: "downloading" }); } } finally { await new Promise<void>((resolve) => writer.end(resolve)); }
  options.onProgress?.({ modelId, downloadedBytes: downloaded, totalBytes: model.sizeBytes, phase: "verifying" });
  if ((await hash(partialPath)) !== model.sha256.toLowerCase()) { await fsp.unlink(partialPath).catch(() => undefined); throw new Error(`SHA-256 mismatch for ${modelId}`); }
  await fsp.rename(partialPath, finalPath); options.onProgress?.({ modelId, downloadedBytes: downloaded, totalBytes: model.sizeBytes, phase: "done" }); return finalPath;
}
export async function verifyModel(modelId: string, modelsDir = defaultModelsDir()): Promise<boolean> { const model = findModel(await loadCatalog(), modelId); const file = path.join(modelsDir, `${model.id}.gguf`); return (await exists(file)) && (await hash(file)) === model.sha256.toLowerCase(); }
