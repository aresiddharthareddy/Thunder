import { dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { CH } from "./channels.js";
import { classifyPath } from "../../core/security.js";

function assertAllowed(targetPath: string, intent: "read" | "write", workspaceRoot: string): void {
  const decision = classifyPath(targetPath, intent, { workspaceRoot });
  if (decision.action !== "allow") throw new Error(`File ${intent} blocked: ${decision.reason}`);
}

export function registerFilesIpc(): void {
  ipcMain.handle(CH.FILE_OPEN_WORKSPACE, async () => { const result = await dialog.showOpenDialog({ properties: ["openDirectory"] }); if (result.canceled || result.filePaths.length === 0) return null; const workspaceRoot = path.resolve(result.filePaths[0]); const files: string[] = []; const ignored = new Set([".git", "node_modules", "dist", "release", ".thunder", ".thunder-build"]); async function visit(directory: string): Promise<void> { if (files.length >= 2000) return; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { if (ignored.has(entry.name) || entry.name.startsWith(".")) continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) await visit(full); else if (entry.isFile() && classifyPath(full, "read", { workspaceRoot }).action === "allow") files.push(path.relative(workspaceRoot, full)); } } await visit(workspaceRoot); return { workspaceRoot, files: files.sort() }; });
  ipcMain.handle(CH.FILE_OPEN, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Code", extensions: ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "py", "rs", "go", "java", "txt"] }] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0]; const workspaceRoot = path.dirname(filePath); assertAllowed(filePath, "read", workspaceRoot);
    return { filePath, workspaceRoot, content: await fs.readFile(filePath, "utf8") };
  });
  ipcMain.handle(CH.FILE_READ, async (_event, payload: { filePath: string; workspaceRoot: string }) => { assertAllowed(payload.filePath, "read", payload.workspaceRoot); return fs.readFile(payload.filePath, "utf8"); });
  ipcMain.handle(CH.FILE_WRITE, async (_event, payload: { filePath: string; workspaceRoot: string; content: string }) => { assertAllowed(payload.filePath, "write", payload.workspaceRoot); await fs.writeFile(payload.filePath, payload.content, "utf8"); return { ok: true }; });
  ipcMain.handle(CH.FILE_TREE, async (_event, payload: { workspaceRoot: string }) => {
    const root = path.resolve(payload.workspaceRoot); const output: string[] = []; const ignored = new Set([".git", "node_modules", "dist", "release", ".thunder", ".thunder-build"]);
    async function visit(directory: string): Promise<void> { if (output.length >= 2000) return; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { if (ignored.has(entry.name) || entry.name.startsWith(".")) continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) await visit(full); else if (entry.isFile()) { const relative = path.relative(root, full); if (classifyPath(full, "read", { workspaceRoot: root }).action === "allow") output.push(relative); } } }
    await visit(root); return output.sort();
  });
}
