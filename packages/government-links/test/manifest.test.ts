import { describe, expect, it } from "vitest";
import { isWellFormedManifest } from "@magna-carta/integrations/manifest";
import { parcelsManifest } from "../src/manifest.ts";

describe("parcelsManifest", () => {
  it("is a well-formed credential-less, default-on manifest", () => {
    expect(isWellFormedManifest(parcelsManifest)).toEqual([]);
    expect(parcelsManifest.credential).toEqual({ kind: "none" });
    expect(parcelsManifest.permission).toBeNull();
    expect(parcelsManifest.defaultEnablement).toBe("on");
  });
});
