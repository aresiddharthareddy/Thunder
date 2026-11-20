import fs from "node:fs/promises";
import path from "node:path";

const app = path.resolve("release/Thunder Workbench.app");
const required = [
  "Contents/Resources/app/extensions/thunder-local/extension.cjs",
  "Contents/Resources/app/extensions/thunder-local/panel.cjs",
  "Contents/Resources/app/extensions/thunder-local/models/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
  "Contents/Resources/app/extensions/thunder-local/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
  "Contents/Frameworks/Thunder Workbench Helper.app/Contents/MacOS/Thunder Workbench Helper",
];
for (const relative of required) {
  const stat = await fs.stat(path.join(app, relative));
  if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid workbench asset: ${relative}`);
}
const product = JSON.parse(await fs.readFile(path.join(app, "Contents/Resources/app/product.json"), "utf8"));
if (product.nameShort !== "Thunder Workbench" || product.dataFolderName !== ".thunder-workbench") throw new Error("Thunder Workbench product metadata is incomplete");
console.log("Thunder Workbench bundle verified.");
