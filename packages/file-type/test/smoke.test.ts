import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@magna-carta/file-type", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("@magna-carta/file-type");
  });
});
