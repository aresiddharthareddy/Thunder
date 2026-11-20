import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { classifyPath, redactSecrets, securityRulesetHash } from "../../core/security.js";
export function registerSecurityIpc(): void { ipcMain.handle(CH.SECURITY_CLASSIFY_PATH, (_event, payload: { targetPath: string; intent: "read" | "write"; workspaceRoot: string }) => classifyPath(payload.targetPath, payload.intent, { workspaceRoot: payload.workspaceRoot })); ipcMain.handle(CH.SECURITY_REDACT, (_event, text: string) => redactSecrets(text)); ipcMain.handle(CH.SECURITY_HASH, () => securityRulesetHash()); }
