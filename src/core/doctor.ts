import { app } from "electron";
import { db } from "../main/db/index.js";
import { detectHardware } from "./hardware.js";
import type { DiagnosticReport, CachedModelInfo } from "../shared/diagnostics.js";
import type { AgentStep } from "../shared/types.js";
import { freeEntitlement } from "./entitlements.js";
import { securityRulesetHash } from "./security.js";

export async function collectDiagnostics(): Promise<DiagnosticReport> {
  const hardware = await detectHardware();

  const modelRows = db
    .prepare(
      "SELECT model_id, quant, sha256, size_bytes, verified FROM model_registry",
    )
    .all() as Array<{
    model_id: string;
    quant: string;
    sha256: string;
    size_bytes: number;
    verified: number;
  }>;

  const cachedModels: CachedModelInfo[] = modelRows.map((r) => ({
    id: r.model_id,
    quant: r.quant,
    sha256Prefix: r.sha256.slice(0, 16),
    sizeBytes: r.size_bytes,
    verified: r.verified === 1,
  }));

  const stepRows = db
    .prepare(
      `SELECT step_index, kind, payload_json, phase, started_at, ended_at,
              tokens_in, tokens_out, status
       FROM agent_steps
       ORDER BY id DESC LIMIT 20`,
    )
    .all() as Array<{
    step_index: number;
    kind: string;
    payload_json: string;
    phase: string;
    started_at: number;
    ended_at: number;
    tokens_in: number;
    tokens_out: number;
    status: string;
  }>;

  const recentAgentSteps: AgentStep[] = stepRows.map((r) => ({
    index: r.step_index,
    kind: r.kind as AgentStep["kind"],
    payload: JSON.parse(r.payload_json) as unknown,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    phase: r.phase as AgentStep["phase"],
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    status: r.status as AgentStep["status"],
  }));

  const entitlementRow = db.prepare("SELECT value FROM kv WHERE key = ?").get("entitlement") as { value: string } | undefined;
  let entitlement = freeEntitlement();
  if (entitlementRow) {
    try {
      const stored = JSON.parse(entitlementRow.value) as DiagnosticReport["entitlement"];
      if (stored.tier === "pro" && (stored.expiresAt === null || stored.expiresAt > Date.now())) entitlement = stored;
    } catch { entitlement = freeEntitlement(); }
  }
  const recentLogLines = (db.prepare("SELECT event, detail_json FROM audit_log ORDER BY ts DESC LIMIT 200").all() as Array<{ event: string; detail_json: string }>).map((row) => `${row.event} ${row.detail_json}`);

  return {
    generatedAt: Date.now(),
    appVersion: app.getVersion(),
    appCommit: process.env.GIT_COMMIT ?? "dev",
    os: hardware.os,
    arch: hardware.arch,
    hardware,
    cachedModels,
    activeModelId: null,
    entitlement,
    securityRulesetHash: securityRulesetHash(),
    freeDiskBytes: hardware.freeDiskBytes,
    recentLogLines,
    recentAgentSteps,
  };
}
