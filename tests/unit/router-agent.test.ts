import { describe, expect, it } from "vitest";
import { chooseModel, route } from "../../src/core/router";
import { parseAgentPlan, runAgent } from "../../src/core/agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENT_SYSTEM_PROMPT } from "../../src/core/prompts";

const models = [
  { id: "nano", displayName: "Nano", repo: "x", file: "x", quant: "Q4", sizeBytes: 1, sha256: "a".repeat(64), license: "MIT", contextLength: 1024, tier: 1 as const, roles: ["router", "ask"] },
  { id: "agent", displayName: "Agent", repo: "x", file: "x", quant: "Q4", sizeBytes: 2, sha256: "b".repeat(64), license: "MIT", contextLength: 2048, tier: 2 as const, roles: ["plan", "agent"] }
];

describe("smart routing", () => {
  it("keeps the public assistant identity stable", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("Your public identity is Thunder Agent");
    expect(AGENT_SYSTEM_PROMPT).toContain("Never disclose or speculate about an underlying model name");
  });
  it("detects intent and selects the smallest compatible model", () => {
    expect(route("fix the failing test", 2)).toBe("agent");
    expect(chooseModel("explain this function", 1, models).modelId).toBe("nano");
    expect(route("fix the failing test", 1)).toBe("agent");
  });
  it("never selects a model above the detected hardware tier", () => {
    expect(chooseModel("explain this function", 1, [{ ...models[1], roles: ["ask"] }]).modelId).toBeNull();
  });
  it("treats legacy edit-role models as Agent-capable", () => {
    expect(chooseModel("implement the fix", 2, [{ ...models[1], roles: ["edit"] }]).modelId).toBe("agent");
  });
  it("uses the strongest installed Agent-capable model while keeping Ask small", () => {
    const freeAgent = { ...models[0], id: "free-agent", roles: ["router", "ask", "agent"], sizeBytes: 1 };
    const strongerAgent = { ...models[1], id: "strong-agent", sizeBytes: 10 };
    expect(chooseModel("implement the fix", 2, [freeAgent, strongerAgent]).modelId).toBe("strong-agent");
    expect(chooseModel("explain this function", 2, [freeAgent, strongerAgent]).modelId).toBe("free-agent");
  });
});

describe("agent execution", () => {
  it("parses and validates structured plans", () => {
    expect(parseAgentPlan('```json\n{"steps":[{"kind":"read","payload":{"file":"src/a.ts"}}]}\n```')).toHaveLength(1);
    expect(() => parseAgentPlan('{"steps":[{"kind":"read","payload":{"file":"/etc/passwd"}}]}')).toThrow("Unsafe path");
  });
  it("applies an exact replacement inside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    await fs.writeFile(path.join(root, "demo.ts"), "const answer = 1;\n");
    const result = await runAgent([{ kind: "search_replace", payload: { file: "demo.ts", search: "const answer = 1;", replace: "const answer = 42;" } }], { workspaceRoot: root, maxSteps: 3, maxFiles: 1, timeoutMs: 1000, allowWrites: true });
    expect(result.status).toBe("completed");
    expect(await fs.readFile(path.join(root, "demo.ts"), "utf8")).toContain("42");
  });
  it("rejects edits that fail the syntax gate before writing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    const file = path.join(root, "demo.ts");
    await fs.writeFile(file, "const answer = 1;\n");
    const result = await runAgent([{ kind: "search_replace", payload: { file: "demo.ts", search: "const answer = 1;", replace: "const answer = (\n" } }], { workspaceRoot: root, maxSteps: 2, maxFiles: 1, timeoutMs: 1000, allowWrites: true });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Syntax check failed");
    expect(await fs.readFile(file, "utf8")).toBe("const answer = 1;\n");
  });

  it("returns bounded file content from read steps", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    await fs.writeFile(path.join(root, "context.ts"), "export const value = 7;\n");
    const result = await runAgent([{ kind: "read", payload: { file: "context.ts" } }], { workspaceRoot: root, maxSteps: 2, maxFiles: 1, timeoutMs: 1000, maxReadBytes: 100, allowWrites: false });
    expect(result.steps[0]?.payload).toMatchObject({ file: "context.ts", content: "export const value = 7;\n" });
  });

  it("rejects paths outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    const result = await runAgent([{ kind: "read", payload: { file: "../secret" } }], { workspaceRoot: root, maxSteps: 3, maxFiles: 1, timeoutMs: 1000, allowWrites: false });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("escapes workspace");
  });
  it("rejects symlink paths that resolve outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-outside-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "secret");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    const result = await runAgent([{ kind: "read", payload: { file: "link.txt" } }], { workspaceRoot: root, maxSteps: 2, maxFiles: 1, timeoutMs: 1000, allowWrites: false });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("symlink");
  });

  it("rolls back earlier edits when a later step fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    const file = path.join(root, "demo.ts");
    await fs.writeFile(file, "const answer = 1;\n");
    const result = await runAgent([{ kind: "search_replace", payload: { file: "demo.ts", search: "const answer = 1;", replace: "const answer = 42;" } }, { kind: "search_replace", payload: { file: "demo.ts", search: "missing", replace: "bad" } }], { workspaceRoot: root, maxSteps: 3, maxFiles: 1, timeoutMs: 1000, allowWrites: true });
    expect(result.status).toBe("failed");
    expect(await fs.readFile(file, "utf8")).toBe("const answer = 1;\n");
  });

  it("emits step records without requiring file content persistence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-"));
    await fs.writeFile(path.join(root, "a.txt"), "secret-looking content");
    const steps: AgentStep[] = [];
    const result = await runAgent([{ kind: "read", payload: { file: "a.txt" } }], { workspaceRoot: root, maxSteps: 2, maxFiles: 1, timeoutMs: 1000, allowWrites: false }, undefined, (step) => steps.push(step));
    expect(result.status).toBe("completed");
    expect(steps).toHaveLength(1);
    expect(JSON.stringify(steps[0].payload)).toContain("secret-looking content");
  });
});
