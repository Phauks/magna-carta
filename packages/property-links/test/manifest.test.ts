import { describe, expect, it } from "vitest";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { propertyLinksManifest } from "../src/manifest.ts";

describe("propertyLinksManifest", () => {
  it("is a well-formed credential-less, default-on manifest", () => {
    expect(isWellFormedManifest(propertyLinksManifest)).toEqual([]);
    expect(propertyLinksManifest.credential).toEqual({ kind: "none" });
    expect(propertyLinksManifest.permission).toBeNull();
    expect(propertyLinksManifest.defaultEnablement).toBe("on");
  });
});
