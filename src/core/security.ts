import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import micromatch from "micromatch";
import { ALL_RULES, PROTECTED_CONFIG_RULES, READ_DENY_RULES, type SecurityRule } from "../shared/security-rules.js";
import type { SecurityDecision } from "../shared/types.js";

let zeroOutbound = false;
export function setZeroOutbound(value: boolean): void { zeroOutbound = value; }
export function isZeroOutbound(): boolean { return zeroOutbound; }
export function assertNoOutbound(opName: string): void { if (zeroOutbound) throw new Error(`Outbound network blocked (Zero Outbound Mode): ${opName}`); }
function normalize(value: string): string { return value.replace(/\\/g, "/").replace(/\/+$/, ""); }
function canonicalize(target: string, root: string): string { const absolute = path.isAbsolute(target) ? target : path.resolve(root, target); let probe = absolute; const rest: string[] = []; for (let i = 0; i < 64; i += 1) { try { return path.join(fs.realpathSync(probe), ...rest.reverse()); } catch { const parent = path.dirname(probe); if (parent === probe) break; rest.push(path.basename(probe)); probe = parent; } } return absolute; }
function aliases(value: string): string[] { const normalized = normalize(value); const output = new Set([normalized]); const home = normalize(os.homedir()); if (normalized.startsWith(`${home}/`)) output.add(`~/${normalized.slice(home.length + 1)}`); const segments = normalized.split("/"); for (let i = 0; i < segments.length; i += 1) output.add(`/${segments.slice(i).join("/")}`); return [...output]; }
function match(value: string, rules: SecurityRule[]): SecurityRule | null { for (const rule of rules) if (aliases(value).some((alias) => micromatch.isMatch(alias, rule.glob, { dot: true }))) return rule; return null; }
export interface ClassifyOptions { workspaceRoot: string; touchesPackageScripts?: boolean; }
export function classifyPath(targetPath: string, intent: "read" | "write", options: ClassifyOptions): SecurityDecision { let canonical: string; try { canonical = canonicalize(targetPath, options.workspaceRoot); } catch (error) { return { action: "deny", reason: `Path resolution failed: ${error instanceof Error ? error.message : "unknown"}`, ruleId: "canonicalize-failed" }; } const safeStub = [".env.example", ".env.sample", ".env.template", "credentials.example"].includes(path.basename(canonical)); const denied = match(canonical, READ_DENY_RULES); if (denied && !safeStub) return { action: "deny", reason: denied.description, ruleId: denied.id }; const root = normalize(canonicalize(options.workspaceRoot, options.workspaceRoot)); const normalized = normalize(canonical); const inside = normalized === root || normalized.startsWith(`${root}/`); if (intent === "write" && !inside) return { action: "deny", reason: "Write outside workspace root", ruleId: "outside-workspace" }; const protectedRule = intent === "write" ? match(canonical, PROTECTED_CONFIG_RULES) : null; if (protectedRule) return { action: "confirm", reason: protectedRule.description, ruleId: protectedRule.id }; return { action: "allow", reason: "No rule matched", ruleId: "default-allow" }; }
export interface RedactResult { text: string; count: number; }
export async function redactSecrets(text: string): Promise<RedactResult> { const patterns = [/\bAKIA[0-9A-Z]{16}\b/g, /\bghp_[A-Za-z0-9]{36}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, /\bsk_live_[A-Za-z0-9]{20,}\b/g, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g]; let count = 0; let redacted = text; for (const pattern of patterns) redacted = redacted.replace(pattern, () => { count += 1; return "[REDACTED]"; }); return { text: redacted, count }; }
export function requiresTerminalApproval(_command: string): boolean { return true; }
export function securityRulesetHash(): string { return crypto.createHash("sha256").update(ALL_RULES.map((rule) => `${rule.category}:${rule.glob}`).sort().join("\n")).digest("hex"); }
