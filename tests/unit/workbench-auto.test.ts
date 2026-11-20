import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const load = createRequire(import.meta.url);
const { planRoute, autoPack } = load("../../ide/extension/auto.cjs");
const { composeContext } = load("../../ide/extension/context.cjs");

const nano = { id: "nano", sizeBytes: 490e6, tier: 1, license: "Apache-2.0", location: "nano.gguf" };
const coder = { id: "coder", sizeBytes: 1.12e9, tier: 1, license: "Apache-2.0", location: "coder.gguf" };
const large = { id: "large", sizeBytes: 4.68e9, tier: 2, license: "Apache-2.0", location: "large.gguf" };
const oversized = { ...large, id: "oversized", sizeBytes: 9e9, tier: 3 };
const models = [large, coder, nano, oversized];

describe("Workbench Auto", () => {
  it("keeps ordinary questions and their token budget on the nano", () => {
    const plan = planRoute(models, { tier: 3, gb: 16 }, { mode: "ask", input: "Why does this handler return early?", sourceCount: 2 });
    expect(plan.primary).toBe(nano);
    expect(plan.triage).toBeUndefined();
    expect(plan.maxTokens).toBe(256);
  });

  it("hands multi-file reasoning from nano context review to a memory-compatible coder", () => {
    const plan = planRoute(models, { tier: 3, gb: 16 }, { mode: "agent", input: "Trace the regression across these files.", sourceCount: 3 });
    expect(plan.triage).toBe(nano);
    expect(plan.primary).toBe(large);
    expect(plan.retry).toBe(large);
  });

  it("starts low-tier Agent on the nano and permits a bounded upgrade only to the lightweight coder", () => {
    const request = { mode: "agent", input: "Change the greeting in hello.ts.", sourceCount: 1 };
    const plan = planRoute(models, { tier: 1, gb: 8 }, request);
    expect(plan.primary).toBe(nano);
    expect(plan.retry).toBe(coder);
    expect(plan.triage).toBeUndefined();
    expect(planRoute(models, { tier: 1, gb: 2 }, request).retry).toBe(nano);
  });

  it("honors an installed, compatible manual pin across generation and repair", () => {
    const plan = planRoute(models, { tier: 3, gb: 16 }, { mode: "agent", input: "Refactor across files.", pin: "coder", sourceCount: 3 });
    expect(plan.primary).toBe(coder);
    expect(plan.retry).toBe(coder);
    expect(plan.triage).toBeUndefined();
  });

  it("offers a hardware-scoped pack with the required license types", () => {
    const restricted = { ...coder, id: "restricted", license: "research" };
    expect(autoPack([...models, restricted], { tier: 1, gb: 8 })).toEqual([coder, nano]);
    expect(autoPack([...models, restricted], { tier: 3, gb: 16 })).toEqual([large, coder, nano]);
  });
});

describe("Workbench context", () => {
  it("keeps a late match and sufficient context for an exact replacement", () => {
    const match = "const pendingRequests = normalize(items);";
    const source = "/* unrelated comments */\n".repeat(400) + match + "\n";
    const context = composeContext(new Map([["src/queue.ts", { before: source }]]), "Update pendingRequests in src/queue.ts.", 1500);
    expect(context).toContain(match);
    expect(context).toMatch(/starts on line 39[0-9]/);
    expect(context.length).toBeLessThanOrEqual(1500);
  });

  it("keeps a match deep within one long line without exceeding the context budget", () => {
    const match = ',"requestLimit":100';
    const source = "{\"values\":[" + "0,".repeat(3000) + "0]" + match + "}";
    const context = composeContext(new Map([["limits.json", { before: source }]]), "Update requestLimit in limits.json.", 900);
    expect(context).toContain(match);
    expect(context.length).toBeLessThanOrEqual(900);
  });
});

describe("Workbench startup and privacy", () => {
  const showInformationMessage = vi.fn();
  const registerWebviewViewProvider = vi.fn();
  const editor = {
    ConfigurationTarget: { Global: 1 },
    window: { showInformationMessage, registerWebviewViewProvider },
    workspace: {
      getConfiguration: () => ({ get: () => true }),
      registerTextDocumentContentProvider: vi.fn(),
      onDidChangeConfiguration: vi.fn(),
    },
    commands: { registerCommand: vi.fn(), executeCommand: vi.fn(async () => undefined) },
  };

  function loadWorkbench() {
    const Module = load("node:module");
    const original = Module._load;
    Module._load = function (specifier: string, ...args: unknown[]) {
      return specifier === "vscode" ? editor : original.call(this, specifier, ...args);
    };
    try {
      return { ...load("../../ide/extension/services.cjs"), ...load("../../ide/extension/extension.cjs") };
    } finally {
      Module._load = original;
    }
  }

  it("keeps a missing pack offline without displaying a download approval", async () => {
    const { Services } = loadWorkbench();
    const services = new Services({ globalState: { get: (_key: string, fallback: string) => fallback }, globalStorageUri: { fsPath: "/test" } });
    services.models = async () => [{ ...nano, location: undefined }];
    services.hw = { tier: 1, gb: 8 };
    await expect(services.hydrate()).rejects.toThrow("Turn off Zero Outbound");
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it("registers the assistant while the account store is still waiting", async () => {
    const { activate, deactivate } = loadWorkbench();
    let finishAccountRead: (value: undefined) => void = () => undefined;
    const pending = new Promise<undefined>(resolve => { finishAccountRead = resolve; });
    const ready = activate({ globalState: { get: (key: string) => key === "welcomed" ? true : [] }, secrets: { get: () => pending }, subscriptions: [] });
    try {
      expect(registerWebviewViewProvider).toHaveBeenCalledWith("thunder.assistant", expect.anything(), expect.anything());
    } finally {
      finishAccountRead(undefined);
      await ready;
      await deactivate();
    }
  });
});
