import { describe, expect, it } from "vitest";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { shippingManifest } from "../src/manifest.ts";

describe("shippingManifest", () => {
  it("is a well-formed firm-scoped apiKey shipping manifest", () => {
    expect(isWellFormedManifest(shippingManifest)).toEqual([]);
    expect(shippingManifest.category).toBe("shipping");
    expect(shippingManifest.credential).toEqual({ kind: "apiKey", scope: "firm" });
    expect(shippingManifest.permission).toBe("shipping:manage");
    expect(shippingManifest.defaultEnablement).toBe("off");
  });
});
