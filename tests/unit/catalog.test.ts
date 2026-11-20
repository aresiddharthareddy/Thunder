import { describe, expect, it } from "vitest";
import fs from "node:fs";

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
});
