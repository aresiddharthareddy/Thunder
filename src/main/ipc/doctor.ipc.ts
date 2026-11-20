import { ipcMain, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { CH } from "./channels.js";
import { collectDiagnostics } from "../../core/doctor.js";

export function registerDoctorIpc(): void {
  ipcMain.handle(CH.DOCTOR_COLLECT, async () => collectDiagnostics());
  ipcMain.handle(CH.DOCTOR_SAVE, async () => {
    const report = await collectDiagnostics();
    const result = await dialog.showSaveDialog({
      defaultPath: `thunder-diagnostic-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, JSON.stringify(report, null, 2), "utf-8");
    return { saved: true, path: result.filePath };
  });
}
