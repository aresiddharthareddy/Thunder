import { ipcMain } from "electron";
import crypto from "node:crypto";
import { CH } from "./channels.js";
import { db } from "../db/index.js";

export function registerChatIpc(): void {
  ipcMain.handle(CH.CHAT_SESSION_CREATE, (_event, payload: { mode: "ask" | "plan" | "agent"; title?: string }) => { const id = crypto.randomUUID(); const now = Date.now(); db.prepare("INSERT INTO chat_sessions (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, payload.title?.trim() || "Thunder session", payload.mode, now, now); return { id }; });
  ipcMain.handle(CH.CHAT_MESSAGE_APPEND, (_event, payload: { sessionId: string; role: "user" | "assistant" | "system" | "tool"; content: string }) => { const id = crypto.randomUUID(); const now = Date.now(); db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)").run(id, payload.sessionId, payload.role, payload.content, now); db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(now, payload.sessionId); return { id }; });
}
