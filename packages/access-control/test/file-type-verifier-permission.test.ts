import { describe, expect, it } from "vitest";
import { assertPermission, isPermission } from "../src/registry.ts";

describe("tools:fileTypeVerifier permission", () => {
  it("is registered", () => {
    expect(isPermission("tools:fileTypeVerifier")).toBe(true);
    expect(assertPermission("tools:fileTypeVerifier")).toBe("tools:fileTypeVerifier");
  });
});
