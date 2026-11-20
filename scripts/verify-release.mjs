import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const releaseDir = path.resolve("release");
const entries = (await fs.readdir(releaseDir).catch(() => []));
const files = [];
for (const entry of entries) { const stat = await fs.stat(path.join(releaseDir, entry)); if (stat.isFile() && entry !== "SHA256SUMS.txt") files.push(entry); }
if (files.length === 0) throw new Error("No release artifacts found. Run pnpm package first.");
const checksums = [];
for (const file of files) {
  const full = path.join(releaseDir, file);
  const stat = await fs.stat(full);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid release artifact: ${file}`);
  checksums.push(`${crypto.createHash("sha256").update(await fs.readFile(full)).digest("hex")}  ${file}`);
}
await fs.writeFile(path.join(releaseDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(`Release checks passed for ${files.length} artifact(s).`);
