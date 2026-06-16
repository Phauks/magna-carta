import { describe, expect, it } from "vitest";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { newCorrelationId, newErrorId } from "../src/ids.ts";

describe("telemetry id minters", () => {
  it("newCorrelationId mints a correlation_ handle", () => {
    const id = newCorrelationId();
    expect(id.startsWith("correlation_")).toBe(true);
    expect(id).toMatch(identifierPattern("correlation"));
  });

  it("newErrorId mints an error_ handle", () => {
    const id = newErrorId();
    expect(id.startsWith("error_")).toBe(true);
    expect(id).toMatch(identifierPattern("error"));
  });

  it("mints a fresh id each call", () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
    expect(newErrorId()).not.toBe(newErrorId());
  });
});
