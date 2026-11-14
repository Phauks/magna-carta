import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("transferRun identifier", () => {
  it("mints a transferRun_ handle", () => {
    const id = newIdentifier("transferRun");
    expect(id).toMatch(/^transferRun_[A-Za-z0-9_-]+$/);
  });
});
