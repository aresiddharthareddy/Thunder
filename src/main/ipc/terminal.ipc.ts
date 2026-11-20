import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { executeTerminal, type TerminalRequest } from "../../core/terminal.js";

export function registerTerminalIpc(): void {
  ipcMain.handle(CH.TERMINAL_EXECUTE, async (_event, request: TerminalRequest) => executeTerminal(request));
}
