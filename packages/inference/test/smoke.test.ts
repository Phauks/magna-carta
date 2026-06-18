import { describe, expect, it } from "vitest";
import { INFERENCE_PACKAGE } from "../src/port.ts";

describe("package", () => {
  it("is wired into the workspace", () => {
    expect(INFERENCE_PACKAGE).toBe("@magna-carta/inference");
  });
});
