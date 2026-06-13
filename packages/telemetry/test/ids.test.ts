import { describe, expect, it } from "vitest";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { newCorrelationId, newErrorId } from "../src/ids.ts";

describe("telemetry id minters", () => {
  it("newCorrelationId mints a cor_ handle", () => {
    const id = newCorrelationId();
    expect(id.startsWith("cor_")).toBe(true);
    expect(id).toMatch(identifierPattern("correlation"));
  });

  it("newErrorId mints an err_ handle", () => {
    const id = newErrorId();
    expect(id.startsWith("err_")).toBe(true);
    expect(id).toMatch(identifierPattern("error"));
  });

  it("mints a fresh id each call", () => {
    expect(newCorrelationId()).not.toBe(newCorrelationId());
    expect(newErrorId()).not.toBe(newErrorId());
  });
});
