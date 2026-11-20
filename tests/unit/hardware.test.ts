import { describe, it, expect } from "vitest";
import { classifyTier, capabilitiesFor } from "../../src/core/hardware.js";
import type { GpuInfo } from "../../src/shared/types.js";

const GB = 1024 ** 3;

function nvidia(vramGb: number): GpuInfo {
  return { vendor: "nvidia", vramBytes: vramGb * GB, name: "NVIDIA test" };
}

function noGpu(): GpuInfo {
  return { vendor: "none", vramBytes: null, name: null };
}

describe("classifyTier", () => {
  it("fixture 1: 8GB x86 CPU-only -> tier 1", () => {
    const r = classifyTier(8 * GB, noGpu(), false);
    expect(r.tier).toBe(1);
  });

  it("fixture 2: 16GB x86 CPU-only -> tier 2", () => {
    const r = classifyTier(16 * GB, noGpu(), false);
    expect(r.tier).toBe(2);
  });

  it("fixture 3: 16GB x86 + 8GB VRAM -> tier 3", () => {
    const r = classifyTier(16 * GB, nvidia(8), false);
    expect(r.tier).toBe(3);
  });

  it("fixture 4: 8GB Apple Silicon -> tier 2.5", () => {
    const r = classifyTier(8 * GB, null, true);
    expect(r.tier).toBe(2.5);
  });

  it("fixture 5: 16GB Apple Silicon -> tier 3", () => {
    const r = classifyTier(16 * GB, null, true);
    expect(r.tier).toBe(3);
  });

  it("fixture 6: 32GB x86 CPU-only -> tier 2", () => {
    const r = classifyTier(32 * GB, noGpu(), false);
    expect(r.tier).toBe(2);
  });
});

describe("capabilitiesFor", () => {
  it("tier 1 has no agent mode", () => {
    const c = capabilitiesFor(1);
    expect(c.modes).toEqual(["ask", "plan"]);
    expect(c.maxFilesPerAgentRun).toBe(1);
    expect(c.agentStepTimeoutMs).toBe(0);
  });

  it("tier 2.5 has 90s step timeout", () => {
    const c = capabilitiesFor(2.5);
    expect(c.agentStepTimeoutMs).toBe(90_000);
    expect(c.modes).toContain("agent");
  });

  it("tier 3 has 8-file budget", () => {
    const c = capabilitiesFor(3);
    expect(c.maxFilesPerAgentRun).toBe(8);
  });
});
