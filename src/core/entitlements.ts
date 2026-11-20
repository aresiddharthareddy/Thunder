import crypto from "node:crypto";
import type { Entitlement, ProFeatureKey } from "../shared/types.js";

export interface LicensePayload {
  email: string;
  plan: Entitlement["plan"];
  issuedAt: number;
  expiresAt: number;
  tier: "pro";
  signature: string;
}

const PRO_FEATURES: ProFeatureKey[] = ["modelLab", "manualPin", "perfTuning", "byokFallback", "teamPolicy", "diagnosticBundle"];

export function freeEntitlement(): Entitlement {
  return { tier: "free", plan: "none", expiresAt: null, offlineGraceUntil: 0, features: Object.fromEntries(PRO_FEATURES.map((feature) => [feature, false])) as Record<ProFeatureKey, boolean> };
}

function unsignedPayload(payload: LicensePayload): string {
  return JSON.stringify({ email: payload.email, plan: payload.plan, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt, tier: payload.tier });
}

function decode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="), "base64");
}

export function encodeLicense(payload: Omit<LicensePayload, "signature">, privateKey: crypto.KeyObject): string {
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64url");
  return Buffer.from(JSON.stringify({ ...payload, signature }), "utf8").toString("base64url");
}

export function verifyLicense(licenseKey: string, publicKey: crypto.KeyObject | string, now = Date.now()): LicensePayload {
  let payload: unknown;
  try { payload = JSON.parse(decode(licenseKey).toString("utf8")); } catch { throw new Error("License key is not valid JSON"); }
  if (!payload || typeof payload !== "object") throw new Error("License payload is invalid");
  const candidate = payload as Partial<LicensePayload>;
  if (typeof candidate.email !== "string" || !candidate.email.includes("@") || !["annual", "monthly", "team"].includes(candidate.plan ?? "") || candidate.tier !== "pro" || typeof candidate.issuedAt !== "number" || typeof candidate.expiresAt !== "number" || typeof candidate.signature !== "string") throw new Error("License payload is incomplete");
  if (candidate.expiresAt <= now) throw new Error("License has expired");
  const valid = crypto.verify(null, Buffer.from(unsignedPayload(candidate as LicensePayload)), publicKey, decode(candidate.signature));
  if (!valid) throw new Error("License signature is invalid");
  return candidate as LicensePayload;
}

export function entitlementFromLicense(payload: LicensePayload, now = Date.now()): Entitlement {
  if (payload.expiresAt <= now) return freeEntitlement();
  return { tier: "pro", plan: payload.plan, expiresAt: payload.expiresAt, offlineGraceUntil: Math.min(payload.expiresAt, now + 7 * 24 * 60 * 60 * 1000), features: Object.fromEntries(PRO_FEATURES.map((feature) => [feature, true])) as Record<ProFeatureKey, boolean> };
}

export function featureEnabled(entitlement: Entitlement, feature: ProFeatureKey, now = Date.now()): boolean {
  return entitlement.expiresAt === null || entitlement.expiresAt > now ? entitlement.features[feature] : false;
}
