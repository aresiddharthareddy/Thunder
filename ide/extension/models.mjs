import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";

export async function verifyFile(file, model, signal) {
  if ((await stat(file)).size !== model.sizeBytes) throw new Error("The model size differs from the catalog.");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  if (hash.digest("hex") !== model.sha256) throw new Error("Model checksum verification failed.");
}

export async function installModel(model, directory, { signal, progress, offline, request = fetch }) {
  if (offline()) throw new Error("Turn off Zero Outbound in Thunder settings to download a model.");
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, model.file);
  const partial = destination + ".partial";
  let offset = await stat(partial).then(s => s.size, e => { if (e.code === "ENOENT") return 0; throw e; });
  async function commit() {
    try { await verifyFile(partial, model, signal); }
    catch (e) { if (!signal.aborted) await rm(partial, { force: true }); throw e; }
    await rename(partial, destination);
    return destination;
  }
  if (offset === model.sizeBytes) return commit();
  if (offset > model.sizeBytes) { await rm(partial); offset = 0; }
  const volume = await statfs(directory);
  if (volume.bavail * volume.bsize < model.sizeBytes - offset) throw new Error("Insufficient free disk space.");
  const url = "https://huggingface.co/" + model.repo + "/resolve/" + model.revision + "/" + model.file;
  const res = await request(url, { signal, headers: offset ? { Range: "bytes=" + offset + "-" } : {} });
  if (!res.ok || !res.body) throw new Error("Model download returned HTTP " + res.status);
  if (res.status === 206) {
    const expected = "bytes " + offset + "-" + (model.sizeBytes - 1) + "/" + model.sizeBytes;
    if (res.headers.get("content-range") !== expected) throw new Error("Unexpected download range.");
  } else if (res.status === 200) offset = 0;
  else throw new Error("Unexpected model response.");
  const file = await open(partial, offset ? "a" : "w", 0o600);
  try {
    for await (const bytes of res.body) {
      signal.throwIfAborted();
      if (offline()) throw new Error("Download paused by Zero Outbound.");
      if (offset + bytes.length > model.sizeBytes) throw new Error("Download exceeds expected size.");
      await file.writeFile(bytes);
      offset += bytes.length;
      progress(offset / model.sizeBytes);
    }
  } finally { await file.close(); }
  if (offset < model.sizeBytes) throw new Error("Download interrupted. Choose the model again to resume.");
  return commit();
}
