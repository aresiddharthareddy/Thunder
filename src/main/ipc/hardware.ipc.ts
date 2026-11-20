import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { detectHardware, capabilitiesFor } from "../../core/hardware.js";
import type { HardwareTier } from "../../shared/types.js";

export function registerHardwareIpc(): void {
  ipcMain.handle(CH.HARDWARE_DETECT, async () => detectHardware());
  ipcMain.handle(CH.HARDWARE_CAPABILITIES, (_e, tier: HardwareTier) =>
    capabilitiesFor(tier),
  );
}
