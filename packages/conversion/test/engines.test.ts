import { describe, expect, it } from "vitest";
import { engineFor } from "../src/engines.ts";

describe("engine map", () => {
  it("resolves unimplemented engines to the deferred engine", async () => {
    for (const id of ["libreoffice", "email", "transcode"] as const) {
      const result = await engineFor(id).convert({
        bytes: new Uint8Array([1, 2, 3]),
        from: "docx",
        to: "pdf",
        recipeRef: "pdf",
      });
      expect(result).toEqual({ ok: false, reason: "engine-not-implemented" });
    }
  });
});
