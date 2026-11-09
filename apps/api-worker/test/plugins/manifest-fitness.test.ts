// apps/api-worker/test/plugins/manifest-fitness.test.ts
import { describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { listManifests } from "../../src/plugins/registry.ts";
import appSource from "../../src/http/app.ts?raw";

describe("plugin manifest fitness", () => {
  const manifests = listManifests();

  it("registers exactly the three built integrations", () => {
    expect(manifests.map((m) => m.id).sort()).toEqual(
      ["easypost", "parcels", "property-links"].sort(),
    );
  });

  it("every manifest is structurally well-formed", () => {
    for (const manifest of manifests) {
      expect(isWellFormedManifest(manifest), manifest.id).toEqual([]);
    }
  });

  it("ids and categories are unique across the registry", () => {
    expect(new Set(manifests.map((m) => m.id)).size).toBe(manifests.length);
    expect(new Set(manifests.map((m) => m.category)).size).toBe(manifests.length);
  });

  it("every declared permission exists in the access-control registry", () => {
    for (const manifest of manifests) {
      if (manifest.permission !== null) {
        expect(isPermission(manifest.permission), manifest.permission).toBe(true);
      }
    }
  });

  it("app.ts names no individual plugin route module (decoupling guard)", () => {
    expect(appSource).not.toContain("routes/shipping");
    expect(appSource).not.toContain("registerShippingRoutes");
  });

  it("the core (app.ts) imports nothing from a plugin package or folder (altitude guard)", () => {
    // The platform seams app.ts builds the PluginRuntime from (the http client, the secret-store seam)
    // must live in platform-neutral homes, not inside any one plugin. If a plugin package or the
    // plugin-named ./shipping/ folder reappears in app.ts, a seam has drifted down to a plugin.
    expect(appSource).not.toContain("@magna-carta/shipping");
    expect(appSource).not.toContain("@magna-carta/parcels");
    expect(appSource).not.toContain("@magna-carta/property-links");
    expect(appSource).not.toContain("./shipping/");
  });
});
