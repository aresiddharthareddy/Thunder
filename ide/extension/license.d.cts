import type { KeyObject } from "node:crypto";

export interface LicensePayload {
  email: string;
  plan: "annual" | "monthly" | "team";
  issuedAt: number;
  expiresAt: number;
  tier: "pro";
  signature: string;
}

export const DEFAULT_LICENSE_PUBLIC_KEY: string;
export function encodeLicense(payload: Omit<LicensePayload, "signature">, privateKey: KeyObject): string;
export function parseLicenseIssuer(pem: string): KeyObject;
export function verifyLicense(licenseKey: string, publicKey: KeyObject | string, now?: number): LicensePayload;
