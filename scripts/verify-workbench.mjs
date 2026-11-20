import fs from "node:fs/promises";
import path from "node:path";

const app = path.resolve("release/Thunder Workbench.app");
const required = [
  "Contents/MacOS/VSCodium",
  "Contents/Resources/app/extensions/thunder-local/extension.cjs",
  "Contents/Resources/app/extensions/thunder-local/panel.cjs",
  "Contents/Resources/app/extensions/thunder-local/runtime/llama-completion",
  "Contents/Resources/app/extensions/thunder-local/runtime/LLAMA-LICENSE",
  "Contents/Resources/app/extensions/thunder-local/models/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
  "Contents/Resources/app/extensions/thunder-local/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
  "Contents/Frameworks/VSCodium Helper.app/Contents/MacOS/VSCodium Helper",
  "Contents/Frameworks/VSCodium Helper (Renderer).app/Contents/MacOS/VSCodium Helper (Renderer)",
];
for (const relative of required) {
  const stat = await fs.stat(path.join(app, relative));
  if (!stat.isFile() || stat.size === 0) throw new Error(`Invalid workbench asset: ${relative}`);
}
const product = JSON.parse(await fs.readFile(path.join(app, "Contents/Resources/app/product.json"), "utf8"));
if (product.nameShort !== "Thunder Workbench" || product.dataFolderName !== ".thunder-workbench") throw new Error("Thunder Workbench product metadata is incomplete");
if (!product.defaultChatAgent?.chatExtensionId || Object.keys(product.defaultChatAgent).some(key => key.endsWith("Url"))) {
  throw new Error("Workbench chat compatibility metadata is invalid");
}
if (!Array.isArray(product.builtInExtensionsEnabledWithAutoUpdates) || product.builtInExtensionsEnabledWithAutoUpdates.length) {
  throw new Error("Workbench requires an empty built-in extension auto-update list");
}
if (product.enableTelemetry !== false || product.updateUrl || product.extensionsGallery) throw new Error("Unexpected Workbench network defaults");
const executable = (await import("node:child_process")).execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
if (executable !== "VSCodium") throw new Error(`Main executable metadata is incorrect: ${executable}`);
console.log("Thunder Workbench bundle verified.");
