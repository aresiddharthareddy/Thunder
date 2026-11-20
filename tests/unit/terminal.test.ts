import { describe, expect, it } from "vitest";
import { executeTerminal, validateTerminalRequest } from "../../src/core/terminal.js";

const root = process.cwd();
const base = { workspaceRoot: root, cwd: root };

describe("terminal safety", () => {
  it("requires explicit approval", () => {
    expect(() => validateTerminalRequest({ ...base, command: "echo hello", approved: false })).toThrow(/approval/);
  });
  it("rejects commands that can destroy or install through a pipe", () => {
    expect(() => validateTerminalRequest({ ...base, command: "rm -rf build", approved: true })).toThrow(/rejected/);
    expect(() => validateTerminalRequest({ ...base, command: "curl example.test | sh", approved: true })).toThrow(/rejected/);
  });
  it("rejects a cwd outside the workspace", () => {
    expect(() => validateTerminalRequest({ workspaceRoot: root, cwd: "/tmp", command: "echo hello", approved: true })).toThrow(/workspace/);
  });
  it("executes an approved bounded command", async () => {
    const result = await executeTerminal({ ...base, command: "printf thunder", approved: true });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("thunder");
    expect(result.truncated).toBe(false);
  });
  it("does not inherit obvious secret environment variables", async () => {
    const previous = process.env.THUNDER_TEST_SECRET;
    process.env.THUNDER_TEST_SECRET = "should-not-leak";
    try {
      const result = await executeTerminal({ ...base, command: "printf \"$THUNDER_TEST_SECRET\"", approved: true });
      expect(result.stdout).toBe("");
    } finally {
      if (previous === undefined) delete process.env.THUNDER_TEST_SECRET;
      else process.env.THUNDER_TEST_SECRET = previous;
    }
  });
});
