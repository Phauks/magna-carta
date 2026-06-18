import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("integrationConnection identifier", () => {
  it("mints an integrationConnection_ handle", () => {
    const id = newIdentifier("integrationConnection");
    expect(id).toMatch(/^integrationConnection_[A-Za-z0-9_-]+$/);
  });
});
