import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, ".thunder-build");
const sourceApp = path.join(build, "codium", "VSCodium.app");
const targetApp = path.join(build, "Thunder.app");
const extensionSource = path.join(root, "ide", "extension");
const extensionTarget = path.join(targetApp, "Contents", "Resources", "app", "extensions", "thunder-local");

await fs.rm(targetApp, { recursive: true, force: true });
await fs.cp(sourceApp, targetApp, { recursive: true });

const productPath = path.join(targetApp, "Contents", "Resources", "app", "product.json");
const product = JSON.parse(await fs.readFile(productPath, "utf8"));
Object.assign(product, {
  nameShort: "Thunder",
  nameLong: "Thunder Local AI IDE",
  applicationName: "thunder",
  dataFolderName: ".thunder",
  urlProtocol: "thunder",
  quality: "stable"
});
await fs.writeFile(productPath, `${JSON.stringify(product, null, 2)}\n`);

await fs.cp(extensionSource, extensionTarget, {
  recursive: true,
  filter: (source) => !source.includes(`${path.sep}models${path.sep}`) && !source.endsWith(`${path.sep}models`)
});
await fs.cp(path.join(extensionSource, "models"), path.join(extensionTarget, "models"), { recursive: true });

console.log(`Built ${targetApp}`);
