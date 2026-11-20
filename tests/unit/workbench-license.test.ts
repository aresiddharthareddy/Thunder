import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLicense, verifyLicense } from "../../src/core/entitlements.js";

const require = createRequire(import.meta.url);
const issuer = generateKeyPairSync("ed25519");
const demo = generateKeyPairSync("ed25519");
const vscode = { window: { showQuickPick: vi.fn(), showInputBox: vi.fn() } };
let directory: string;
let secrets: Map<string, string>;
const instances: Array<{ dispose(): void }> = [];

function makeServices() {
  const Module = require("node:module");
  const load = Module._load;
  Module._load = function (name: string, ...args: unknown[]) {
    return name === "vscode" ? vscode : load.call(this, name, ...args);
  };
  try {
    const { Services } = require("../../ide/extension/services.cjs");
    const service = new Services({
      extensionPath: directory,
      globalStorageUri: { fsPath: directory },
      secrets: {
        get: async (name: string) => secrets.get(name),
        store: async (name: string, value: string) => { secrets.set(name, value); },
        delete: async (name: string) => { secrets.delete(name); },
      },
    });
    instances.push(service);
    return service;
  } finally {
    Module._load = load;
  }
}

function license(until = Date.now() + 60_000) {
  return encodeLicense({ email: "buyer@example.test", plan: "monthly", issuedAt: Date.now() - 1, expiresAt: until, tier: "pro" }, issuer.privateKey);
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "thunder-license-"));
  secrets = new Map();
  const users = [{ user: "admin", role: "admin" }, { user: "siddhartha", role: "free" }];
  const signature = sign(null, Buffer.from(JSON.stringify(users)), demo.privateKey).toString("base64");
  await Promise.all([
    writeFile(path.join(directory, "license-public.pem"), issuer.publicKey.export({ type: "spki", format: "pem" })),
    writeFile(path.join(directory, "demo-public.pem"), demo.publicKey.export({ type: "spki", format: "pem" })),
    writeFile(path.join(directory, "demo-accounts.json"), JSON.stringify({ users, signature })),
  ]);
});

afterEach(async () => {
  for (const service of instances.splice(0)) service.dispose();
  vi.restoreAllMocks();
  vscode.window.showQuickPick.mockReset();
  vscode.window.showInputBox.mockReset();
  await rm(directory, { recursive: true, force: true });
});

describe("Workbench signed Pro access", () => {
  it("activates, restores and removes an offline subscription", async () => {
    const original = makeServices();
    expect(original.pro).toBe(false);
    vscode.window.showQuickPick.mockResolvedValue("Activate Pro license");
    vscode.window.showInputBox.mockResolvedValue(license());
    expect(await original.account()).toBe(true);
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ password: true }));
    expect(original.pro).toBe(true);
    expect(original.profileScope).toBe("license:buyer@example.test");

    const reopened = makeServices();
    await reopened.init();
    expect(reopened.pro).toBe(true);
    vscode.window.showQuickPick.mockResolvedValue("Remove local license");
    expect(await reopened.account()).toBe(true);
    expect(reopened.pro).toBe(false);
    expect(secrets.has("pro-license")).toBe(false);
  });

  it("checks expiry while running and rejects expired or modified licenses on restore", async () => {
    const original = makeServices();
    const expiresAt = Date.now() + 60_000;
    const value = license(expiresAt);
    await original.activateLicense(value);
    vi.spyOn(Date, "now").mockReturnValue(expiresAt);
    expect(original.pro).toBe(false);
    const reopened = makeServices();
    await reopened.init();
    expect(reopened.pro).toBe(false);
    vi.restoreAllMocks();

    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    secrets.set("pro-license", Buffer.from(JSON.stringify({ ...data, plan: "annual" })).toString("base64url"));
    const modified = makeServices();
    await modified.init();
    expect(modified.pro).toBe(false);
  });

  it("keeps the demo Free account Free with a valid subscription present and the demo admin Pro without one", async () => {
    secrets.set("demo-session", "siddhartha");
    secrets.set("pro-license", license());
    const free = makeServices();
    await free.init();
    expect(free.pro).toBe(false);
    expect(free.profileScope).toBe("demo:siddhartha");
    await expect(free.activateLicense(license())).rejects.toThrow("Sign out");

    secrets.set("demo-session", "admin");
    secrets.delete("pro-license");
    const admin = makeServices();
    await admin.init();
    expect(admin.pro).toBe(true);
    expect(admin.profileScope).toBe("demo:admin");
  });

  it("keeps Pro closed while a demo account is still being restored", async () => {
    const service = makeServices();
    let finish: (user: string) => void = () => undefined;
    const user = new Promise<string>(resolve => { finish = resolve; });
    const value = license();
    service.ctx.secrets.get = async (key: string) => key === "demo-session" ? user : value;
    service.readLicense = async () => verifyLicense(value, issuer.publicKey);
    const restoring = service.init();
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(service.pro).toBe(false);
    } finally {
      finish("siddhartha");
      await restoring;
    }
    expect(service.pro).toBe(false);
  });
});
