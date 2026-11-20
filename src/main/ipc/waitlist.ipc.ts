import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { db } from "../db/index.js";
import { validateWaitlistRequest, type WaitlistRequest } from "../../core/waitlist.js";

export function registerWaitlistIpc(): void {
  ipcMain.handle(CH.WAITLIST_SUBMIT, (_event, request: WaitlistRequest) => {
    const valid = validateWaitlistRequest(request);
    db.prepare("INSERT OR IGNORE INTO waitlist (email, plan_interest, submitted_at) VALUES (?, ?, ?)").run(valid.email, valid.planInterest, Date.now());
    return { submitted: true };
  });
}
