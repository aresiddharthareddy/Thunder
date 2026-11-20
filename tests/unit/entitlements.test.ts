import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { encodeLicense, entitlementFromLicense, featureEnabled, freeEntitlement, verifyLicense } from "../../src/core/entitlements.js";

describe("offline entitlements", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const future = Date.now() + 86_400_000;
  const license = { email: "dev@example.com", plan: "annual" as const, issuedAt: Date.now(), expiresAt: future, tier: "pro" as const };
  it("accepts a valid Ed25519 license", () => expect(verifyLicense(encodeLicense(license, keys.privateKey), keys.publicKey).email).toBe(license.email));
  it("rejects tampering and expired keys", () => {
    const key = encodeLicense(license, keys.privateKey);
    const decoded = JSON.parse(Buffer.from(key, "base64url").toString("utf8")) as Record<string, unknown>;
    decoded.email = "attacker@example.com";
    expect(() => verifyLicense(Buffer.from(JSON.stringify(decoded)).toString("base64url"), keys.publicKey)).toThrow(/signature/);
    expect(() => verifyLicense(encodeLicense({ ...license, expiresAt: Date.now() - 1 }, keys.privateKey), keys.publicKey)).toThrow(/expired/);
  });
  it("enables Pro features and expires them", () => {
    const entitlement = entitlementFromLicense({ ...license, signature: "" });
    expect(featureEnabled(entitlement, "modelLab")).toBe(true);
    expect(featureEnabled(entitlement, "modelLab", future + 1)).toBe(false);
    expect(freeEntitlement().tier).toBe("free");
  });
});
