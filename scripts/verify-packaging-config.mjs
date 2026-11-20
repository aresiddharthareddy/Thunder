import fs from "node:fs/promises";

const config = await fs.readFile("electron-builder.yml", "utf8");
const required = [
  "productName: Thunder",
  "asar: true",
  "target: dmg",
  "arch: [arm64, x64]",
  "target: nsis",
  "target: AppImage",
  "node_modules/node-llama-cpp/**/*",
  "node_modules/better-sqlite3/**/*",
];
for (const marker of required) if (!config.includes(marker)) throw new Error(`Packaging configuration is missing: ${marker}`);
console.log("Packaging configuration covers macOS, Windows, Linux, asar, and native-module unpacking.");
