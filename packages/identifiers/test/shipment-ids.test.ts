import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("shipment identifiers", () => {
  it.each(["shipment", "shipmentLabel", "trackingEvent"] as const)("mints a %s handle", (type) => {
    expect(newIdentifier(type)).toMatch(new RegExp(`^${type}_[A-Za-z0-9_-]+$`));
  });
});
