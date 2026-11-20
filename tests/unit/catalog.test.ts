import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { mergeCatalog } from "../../src/core/catalog";

describe("bundled model catalog", () => {
  it("contains pinned, verifiable entries", () => {
    const catalog = JSON.parse(fs.readFileSync("resources/models.json", "utf8")) as { models: Array<{ id: string; revision?: string; sha256: string; sizeBytes: number; roles: string[] }> };
    expect(catalog.models.length).toBeGreaterThanOrEqual(4);
    for (const model of catalog.models) {
      expect(model.id).toMatch(/^[a-z0-9.-]+$/);
      expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.roles.length).toBeGreaterThan(0);
    }
  });
  it("allows remote metadata only for bundled pinned identities", () => {
    const bundled = JSON.parse(fs.readFileSync("resources/models.json", "utf8")) as { schemaVersion: number; models: Array<Record<string, unknown>> };
    const first = bundled.models[0];
    const merged = mergeCatalog(bundled as never, { schemaVersion: 99, models: [{ ...first, displayName: "Remote label", repo: "attacker/repo", sha256: "f".repeat(64) }] } as never);
    expect(merged.models[0]?.displayName).toBe("Remote label");
    expect(merged.models[0]?.repo).toBe(first.repo);
    expect(merged.models[0]?.sha256).toBe(first.sha256);
    expect(merged.models).toHaveLength(bundled.models.length);
  });
});
