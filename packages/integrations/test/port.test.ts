import { describe, expect, it } from "vitest";
import { supports, type CapabilityDescriptor } from "../src/port.ts";

const descriptor: CapabilityDescriptor = {
  adapterId: "example",
  category: "example-category",
  credential: { kind: "none" },
  operations: { read: { supported: true }, write: { supported: false } },
  passthroughAvailable: false,
};

describe("supports", () => {
  it("is true only for a declared, supported operation", () => {
    expect(supports(descriptor, "read")).toBe(true);
    expect(supports(descriptor, "write")).toBe(false);
    expect(supports(descriptor, "undeclared")).toBe(false);
  });
});
