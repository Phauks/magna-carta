import { describe, expect, it } from "vitest";
import { listManifests } from "../../src/plugins/registry.ts";

describe("plugin registry", () => {
  it("starts empty until plugins are registered", () => {
    // Scaffold task: the index is empty here; later tasks add shipping/parcels/property-links.
    expect(Array.isArray(listManifests())).toBe(true);
  });
});
