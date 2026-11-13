import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("transferSourceFile identifier", () => {
  it("mints a transferSourceFile_ handle", () => {
    const id = newIdentifier("transferSourceFile");
    expect(id).toMatch(/^transferSourceFile_[A-Za-z0-9_-]+$/);
  });
});
