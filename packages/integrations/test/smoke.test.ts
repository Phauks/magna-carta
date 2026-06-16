import { describe, expect, it } from "vitest";
import { INTEGRATIONS_PACKAGE } from "../src/problem.ts";

describe("package", () => {
  it("is wired into the workspace", () => {
    expect(INTEGRATIONS_PACKAGE).toBe("@magna-carta/integrations");
  });
});
