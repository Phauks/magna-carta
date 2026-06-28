import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("file-type-verifier catalog row", () => {
  it("is present, in the documents group, file/none contextual, library-backed", () => {
    const row = CATALOG.find((t) => t.id === "file-type-verifier");
    expect(row).toBeDefined();
    expect(row?.subjectGroup).toBe("documents");
    expect(row?.contextTags).toEqual(["file", "none"]);
    expect(row?.backing).toEqual({ kind: "library" });
    expect(row?.matterContext).toBe("none");
  });
});
