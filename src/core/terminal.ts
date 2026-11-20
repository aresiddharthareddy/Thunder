import { spawn } from "node:child_process";
import path from "node:path";
import { requiresTerminalApproval } from "./security.js";

const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface TerminalRequest {
  command: string;
  cwd: string;
  workspaceRoot: string;
  approved: boolean;
  timeoutMs?: number;
}

export interface TerminalResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

function inside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function dangerous(command: string): boolean {
  return /(^|[;&|]\s*)(sudo|rm\s+-rf|mkfs(?:\s|$)|diskutil\s+erase|format\s+[a-z]:|curl\b[^\n|]*\|\s*(sh|bash)|wget\b[^\n|]*\|\s*(sh|bash)|chmod\s+777)(?:\s|$)/i.test(command.trim());
}
function terminalEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:token|password|passwd|secret|private[_-]?key|api[_-]?key)/i.test(key)));
}

export function validateTerminalRequest(request: TerminalRequest): void {
  if (!request.command.trim()) throw new Error("Terminal command cannot be empty");
  if (!inside(request.workspaceRoot, request.cwd)) throw new Error("Terminal cwd must be inside the workspace");
  if (dangerous(request.command)) throw new Error("Terminal command rejected by the safe execution policy");
  if (requiresTerminalApproval(request.command) && !request.approved) throw new Error("Terminal command requires explicit approval");
}

export function executeTerminal(request: TerminalRequest, signal?: AbortSignal): Promise<TerminalResult> {
  validateTerminalRequest(request);
  const started = Date.now();
  const timeoutMs = Math.max(1_000, Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", request.command] : ["-c", request.command];
    const child = spawn(shell, args, { cwd: path.resolve(request.cwd), env: terminalEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const current = target === "stdout" ? stdout : stderr;
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current, "utf8");
      if (remaining <= 0) { truncated = true; return; }
      const text = chunk.subarray(0, remaining).toString("utf8");
      if (target === "stdout") stdout += text; else stderr += text;
      if (text.length < chunk.length) truncated = true;
    };
    const abort = (): void => { if (!settled) child.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", (exitCode, closeSignal) => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ exitCode, signal: closeSignal, stdout, stderr, truncated, durationMs: Date.now() - started });
    });
  });
}
