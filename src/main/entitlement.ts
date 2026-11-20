import { readFileSync } from "node:fs";
import { entitlementFromLicense, freeEntitlement, verifyLicense } from "../core/entitlements.js";
import type { Entitlement } from "../shared/types.js";
import { db } from "./db/index.js";

const LICENSE_KEY = "signed_license";

function authenticate(token: string): Entitlement {
  const key = readFileSync(new URL("./license-public.pem", import.meta.url), "utf8");
  return entitlementFromLicense(verifyLicense(token, key));
}

export function readEntitlement(): Entitlement {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(LICENSE_KEY) as { value: string } | undefined;
  try {
    return row ? authenticate(row.value) : freeEntitlement();
  } catch {
    return freeEntitlement();
  }
}

export function activateLicense(token: string): Entitlement {
  const normalized = typeof token === "string" ? token.trim() : "";
  const entitlement = authenticate(normalized);
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(LICENSE_KEY, normalized);
  return entitlement;
}
