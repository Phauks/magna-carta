import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("transferPass identifier", () => {
  it("mints a transferPass_ handle", () => {
    const id = newIdentifier("transferPass");
    expect(id).toMatch(/^transferPass_[A-Za-z0-9_-]+$/);
  });
});
