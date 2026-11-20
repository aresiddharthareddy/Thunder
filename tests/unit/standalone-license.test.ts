import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { encodeLicense } from "../../src/core/entitlements.js";
import { activateLicense, readEntitlement } from "../../src/main/entitlement.js";

const { rows, keyFile } = vi.hoisted(() => ({ rows: new Map<string, string>(), keyFile: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: keyFile }));
vi.mock("../../src/main/db/index.js", () => ({
  db: {
    prepare: () => ({
      get: (key: string) => rows.has(key) ? { value: rows.get(key) } : undefined,
      run: (key: string, value: string) => rows.set(key, value),
    }),
  },
}));

afterEach(() => {
  rows.clear();
  keyFile.mockReset();
  vi.restoreAllMocks();
});

it("does not grant Pro from a cached tier flag", () => {
  rows.set("entitlement", '{"tier":"pro","expiresAt":null}');
  rows.set("signed_license", '{"tier":"pro","expiresAt":null}');
  expect(readEntitlement().tier).toBe("free");
});

it("stores the signed license and revalidates it on read and expiry", () => {
  const keys = generateKeyPairSync("ed25519");
  keyFile.mockReturnValue(keys.publicKey.export({ type: "spki", format: "pem" }));
  const expiresAt = Date.now() + 10_000;
  const value = encodeLicense({ email: "buyer@example.test", plan: "annual", issuedAt: Date.now(), expiresAt, tier: "pro" }, keys.privateKey);
  expect(activateLicense(value).tier).toBe("pro");
  expect(rows.get("signed_license")).toBe(value);
  expect(readEntitlement().tier).toBe("pro");
  vi.spyOn(Date, "now").mockReturnValue(expiresAt);
  expect(readEntitlement().tier).toBe("free");
});
