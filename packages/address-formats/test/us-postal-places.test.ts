import { describe, expect, it } from "vitest";
import { usPostalPlaceFor } from "../src/us-postal-places.ts";

describe("the town a United States ZIP code belongs to", () => {
  it("names the town and the state for a five-digit code", () => {
    expect(usPostalPlaceFor("62701")).toEqual({ city: "Springfield", region: "IL" });
    expect(usPostalPlaceFor("95014")).toEqual({ city: "Cupertino", region: "CA" });
  });

  it("reads a ZIP+4 by its first five digits", () => {
    expect(usPostalPlaceFor("62701-1234")).toEqual({ city: "Springfield", region: "IL" });
  });

  it("says nothing for a code still being typed, or one it does not know", () => {
    expect(usPostalPlaceFor("6270")).toBeNull();
    expect(usPostalPlaceFor("00000")).toBeNull();
    expect(usPostalPlaceFor("")).toBeNull();
  });
});
