import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "release", "Thunder Workbench.app");
const workspace = path.join(root, "test-app");
if (!fs.existsSync(path.join(app, "Contents", "MacOS", "VSCodium"))) throw new Error("Build the workbench first with pnpm build:workbench");
if (process.platform === "darwin") execFileSync("open", ["-n", app, "--args", `--user-data-dir=${path.join(root, ".thunder-build", "demo-profile")}`, workspace], { stdio: "inherit" });
else throw new Error("The local demo launcher currently supports macOS. Use the packaged platform artifact on Windows or Linux.");
