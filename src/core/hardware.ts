import os from "node:os";
import si from "systeminformation";
import checkDiskSpace from "check-disk-space";
import type {
  HardwareProfile,
  HardwareTier,
  GpuInfo,
  GpuVendor,
  Mode,
} from "../shared/types.js";

const GB = 1024 ** 3;
const TWELVE_GB = 12 * GB;
const SIXTEEN_GB = 16 * GB;
const EIGHT_GB = 8 * GB;
const SIX_GB_VRAM = 6 * GB;

function isAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function mapVendor(rawVendor: string): GpuVendor {
  const v = rawVendor.toLowerCase();
  if (v.includes("nvidia")) return "nvidia";
  if (v.includes("amd") || v.includes("radeon")) return "amd";
  if (v.includes("intel")) return "intel";
  if (v.includes("apple")) return "apple";
  return "none";
}

function normOs(): HardwareProfile["os"] {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "linux";
}

function normArch(): HardwareProfile["arch"] {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function gb(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function classifyTier(
  totalRamBytes: number,
  gpu: GpuInfo | null,
  appleSilicon: boolean,
): { tier: HardwareTier; tierReason: string } {
  if (appleSilicon) {
    if (totalRamBytes >= SIXTEEN_GB) {
      return {
        tier: 3,
        tierReason: `Apple Silicon with ${gb(totalRamBytes)} unified memory (>= 16 GB)`,
      };
    }
    if (totalRamBytes >= EIGHT_GB) {
      return {
        tier: 2.5,
        tierReason: `Apple Silicon with ${gb(totalRamBytes)} unified memory (8–16 GB)`,
      };
    }
    return {
      tier: 1,
      tierReason: `Apple Silicon with ${gb(totalRamBytes)} unified memory (< 8 GB)`,
    };
  }

  const vram = gpu?.vramBytes ?? null;
  if (vram !== null && vram >= SIX_GB_VRAM) {
    return { tier: 3, tierReason: `Discrete GPU with ${gb(vram)} VRAM (>= 6 GB)` };
  }
  if (totalRamBytes < TWELVE_GB) {
    return { tier: 1, tierReason: `${gb(totalRamBytes)} RAM (< 12 GB)` };
  }
  return {
    tier: 2,
    tierReason: `${gb(totalRamBytes)} RAM, no >= 6 GB VRAM (>= 12 GB)`,
  };
}

export async function detectHardware(): Promise<HardwareProfile> {
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const apple = isAppleSilicon();

  let gpu: GpuInfo | null = null;
  try {
    const graphics = await si.graphics();
    const controllers = graphics.controllers ?? [];
    const primary = controllers.find((c) => (c.vram ?? 0) > 0) ?? controllers[0];
    if (primary) {
      const vramMb = primary.vram ?? 0;
      gpu = {
        vendor: mapVendor(primary.vendor ?? ""),
        vramBytes: apple ? totalRamBytes : vramMb > 0 ? vramMb * 1024 * 1024 : null,
        name: primary.model ?? null,
      };
    }
  } catch {
    gpu = null;
  }

  if (!gpu) {
    gpu = {
      vendor: apple ? "apple" : "none",
      vramBytes: apple ? totalRamBytes : null,
      name: null,
    };
  }

  let freeDiskBytes = 0;
  try {
    const root = process.platform === "win32" ? "C:" : "/";
    const space = await checkDiskSpace(root);
    freeDiskBytes = space.free;
  } catch {
    freeDiskBytes = 0;
  }

  const { tier, tierReason } = classifyTier(totalRamBytes, gpu, apple);

  return {
    os: normOs(),
    arch: normArch(),
    totalRamBytes,
    freeRamBytes,
    isAppleSilicon: apple,
    gpu,
    freeDiskBytes,
    tier,
    tierReason,
  };
}

export interface TierCapabilities {
  modes: Mode[];
  maxFilesPerAgentRun: number;
  agentStepTimeoutMs: number;
}

export function capabilitiesFor(tier: HardwareTier): TierCapabilities {
  switch (tier) {
    case 1:
      return { modes: ["ask", "plan", "agent"], maxFilesPerAgentRun: 1, agentStepTimeoutMs: 60_000 };
    case 2:
      return {
        modes: ["ask", "plan", "agent"],
        maxFilesPerAgentRun: 2,
        agentStepTimeoutMs: 120_000,
      };
    case 2.5:
      return {
        modes: ["ask", "plan", "agent"],
        maxFilesPerAgentRun: 2,
        agentStepTimeoutMs: 90_000,
      };
    case 3:
      return {
        modes: ["ask", "plan", "agent"],
        maxFilesPerAgentRun: 8,
        agentStepTimeoutMs: 300_000,
      };
  }
}
