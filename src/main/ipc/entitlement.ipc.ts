import { ipcMain } from "electron";
import crypto from "node:crypto";
import { CH } from "./channels.js";
import { db } from "../db/index.js";
import { entitlementFromLicense, freeEntitlement, verifyLicense } from "../../core/entitlements.js";
import type { Entitlement } from "../../shared/types.js";

// The private signing key never ships in Thunder. Releases may override this
// public key during a controlled key rotation, while normal builds remain
// verifiable offline without extra configuration.
const PUBLIC_KEY = process.env.THUNDER_LICENSE_PUBLIC_KEY ?? `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAX13Tb/tz/vd5893nHZhwwRi1DS2VoBURV+geDnSQDog=
-----END PUBLIC KEY-----`;
function readEntitlement(): Entitlement {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("entitlement") as { value: string } | undefined;
  if (!row) return freeEntitlement();
  try { return JSON.parse(row.value) as Entitlement; } catch { return freeEntitlement(); }
}

export function registerEntitlementIpc(): void {
  ipcMain.handle(CH.ENTITLEMENT_GET, () => readEntitlement());
  ipcMain.handle(CH.ENTITLEMENT_ACTIVATE, (_event, licenseKey: string) => {
    const payload = verifyLicense(licenseKey, crypto.createPublicKey(PUBLIC_KEY));
    const entitlement = entitlementFromLicense(payload);
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run("entitlement", JSON.stringify(entitlement));
    return entitlement;
  });
}
