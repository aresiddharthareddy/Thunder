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
  ipcMain.handle(CH.FILE_OPEN, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Code", extensions: ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "py", "rs", "go", "java", "txt"] }] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0]; const workspaceRoot = path.dirname(filePath); assertAllowed(filePath, "read", workspaceRoot);
    return { filePath, workspaceRoot, content: await fs.readFile(filePath, "utf8") };
  });
  ipcMain.handle(CH.FILE_READ, async (_event, payload: { filePath: string; workspaceRoot: string }) => { assertAllowed(payload.filePath, "read", payload.workspaceRoot); return fs.readFile(payload.filePath, "utf8"); });
  ipcMain.handle(CH.FILE_WRITE, async (_event, payload: { filePath: string; workspaceRoot: string; content: string }) => { assertAllowed(payload.filePath, "write", payload.workspaceRoot); await fs.writeFile(payload.filePath, payload.content, "utf8"); return { ok: true }; });
}
