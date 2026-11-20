import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { executeTerminal, type TerminalRequest } from "../../core/terminal.js";
import crypto from "node:crypto";
import { db } from "../db/index.js";

export function registerTerminalIpc(): void {
  ipcMain.handle(CH.TERMINAL_EXECUTE, async (_event, request: TerminalRequest) => { const result = await executeTerminal(request); db.prepare("INSERT INTO audit_log (ts, event, detail_json) VALUES (?, ?, ?)").run(Date.now(), "terminal.execute", JSON.stringify({ commandSha256: crypto.createHash("sha256").update(request.command).digest("hex"), cwd: request.cwd, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated })); return result; });
}
