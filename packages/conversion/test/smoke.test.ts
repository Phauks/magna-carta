import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@magna-carta/conversion", () => {
  it("is wired up", () => {
    expect(PACKAGE_NAME).toBe("@magna-carta/conversion");
  });
});
