import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { assertNoOutbound, classifyPath, redactSecrets, requiresTerminalApproval, setZeroOutbound } from "../../src/core/security.js";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "thunder-security-"));
describe("security policy", () => {
  it("denies secrets and allows safe dotenv stubs", () => {
    expect(classifyPath(".env", "read", { workspaceRoot: workspace }).action).toBe("deny");
    expect(classifyPath(".env.example", "read", { workspaceRoot: workspace }).action).toBe("allow");
    expect(classifyPath(".ssh/id_rsa", "read", { workspaceRoot: workspace }).action).toBe("deny");
  });
  it("denies writes outside and confirms protected config", () => {
    expect(classifyPath("/tmp/evil.txt", "write", { workspaceRoot: workspace }).ruleId).toBe("outside-workspace");
    expect(classifyPath(".vscode/settings.json", "write", { workspaceRoot: workspace }).action).toBe("confirm");
  });
  it("redacts common credentials", async () => {
    const result = await redactSecrets("key=AKIAIOSFODNN7EXAMPLE token=ghp_123456789012345678901234567890123456");
    expect(result.count).toBe(2);
    expect(result.text).not.toContain("AKIA");
  });
  it("redacts secrets before context is sent to inference", async () => {
    const result = await redactSecrets("const token = ghp_123456789012345678901234567890123456;");
    expect(result.text).toBe("const token = [REDACTED];");
  });
  it("requires approval for every terminal command in v1", () => { expect(requiresTerminalApproval("echo hello")).toBe(true); });
  it("blocks outbound operations only when enabled", () => {
    setZeroOutbound(true);
    expect(() => assertNoOutbound("test")).toThrow(/Outbound network blocked/);
    setZeroOutbound(false);
    expect(() => assertNoOutbound("test")).not.toThrow();
  });
});
