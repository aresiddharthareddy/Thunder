import fs from "node:fs/promises";
import path from "node:path";

const target = process.argv[2];
if (!target || !["mac", "linux", "windows"].includes(target)) throw new Error("Usage: node scripts/verify-artifact.mjs mac|linux|windows");
const release = path.resolve("release");
const entries = await fs.readdir(release).catch(() => []);
async function regular(file) { const stat = await fs.stat(file); if (!stat.isFile() || stat.size === 0) throw new Error(`Empty artifact: ${file}`); }
if (target === "mac") {
  const apps = [];
  for (const entry of entries) {
    const candidate = path.join(release, entry, "Thunder.app");
    try { if ((await fs.stat(candidate)).isDirectory()) apps.push(candidate); } catch { /* ignore non-app entries */ }
  }
  if (apps.length === 0) throw new Error("No macOS .app bundle was produced");
  for (const app of apps) await regular(path.join(app, "Contents", "Resources", "app.asar"));
} else if (target === "linux") {
  const image = entries.find((entry) => entry.endsWith(".AppImage"));
  if (!image) throw new Error("No Linux AppImage was produced");
  await regular(path.join(release, image));
} else {
  const installer = entries.find((entry) => entry.endsWith(".exe"));
  if (!installer) throw new Error("No Windows NSIS installer was produced");
  await regular(path.join(release, installer));
}
console.log(`Packaged ${target} artifact verified.`);
