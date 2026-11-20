import type { LicensePayload } from "../../ide/extension/license.cjs";
import type { Entitlement, ProFeatureKey } from "../shared/types.js";

export { DEFAULT_LICENSE_PUBLIC_KEY, encodeLicense, verifyLicense } from "../../ide/extension/license.cjs";
export type { LicensePayload } from "../../ide/extension/license.cjs";

const PRO_FEATURES: ProFeatureKey[] = ["modelLab", "manualPin", "perfTuning", "byokFallback", "teamPolicy", "diagnosticBundle"];

export function freeEntitlement(): Entitlement {
  return { tier: "free", plan: "none", expiresAt: null, offlineGraceUntil: 0, features: Object.fromEntries(PRO_FEATURES.map((feature) => [feature, false])) as Record<ProFeatureKey, boolean> };
}

export function entitlementFromLicense(payload: LicensePayload, now = Date.now()): Entitlement {
  if (payload.expiresAt <= now) return freeEntitlement();
  return { tier: "pro", plan: payload.plan, expiresAt: payload.expiresAt, offlineGraceUntil: Math.min(payload.expiresAt, now + 7 * 24 * 60 * 60 * 1000), features: Object.fromEntries(PRO_FEATURES.map((feature) => [feature, true])) as Record<ProFeatureKey, boolean> };
}

export function featureEnabled(entitlement: Entitlement, feature: ProFeatureKey, now = Date.now()): boolean {
  return entitlement.expiresAt === null || entitlement.expiresAt > now ? entitlement.features[feature] : false;
}
