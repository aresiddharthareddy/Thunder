import { ipcMain } from "electron";
import { CH } from "./channels.js";
import { activateLicense, readEntitlement } from "../entitlement.js";

export function registerEntitlementIpc(): void {
  ipcMain.handle(CH.ENTITLEMENT_GET, () => readEntitlement());
  ipcMain.handle(CH.ENTITLEMENT_ACTIVATE, (_event, licenseKey: string) => activateLicense(licenseKey));
}
