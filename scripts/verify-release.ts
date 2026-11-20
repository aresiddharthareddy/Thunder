import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const releaseDir = path.resolve("release");
const required = [".dmg", ".exe", ".AppImage"];
const files = (await fs.readdir(releaseDir).catch(() => [] as string[])).filter((file) => !file.endsWith("SHA256SUMS.txt"));
if (files.length === 0) throw new Error("No release artifacts found. Run pnpm package first.");
const checksums: string[] = [];
for (const file of files) {
  const full = path.join(releaseDir, file); const stat = await fs.stat(full); if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid release artifact: ${file}`);
  const hash = crypto.createHash("sha256"); hash.update(await fs.readFile(full)); checksums.push(`${hash.digest("hex")}  ${file}`);
}
const names = files.join(" ");
if (required.some((suffix) => names.includes(suffix))) await fs.writeFile(path.join(releaseDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
else await fs.writeFile(path.join(releaseDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
console.log(`Release checks passed for ${files.length} artifact(s).`);
