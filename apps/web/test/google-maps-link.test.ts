// @node-runtime
import { describe, expect, it } from "vitest";
import { googleMapsLinkFor } from "../src/lib/addresses/google-maps-link.ts";

describe("googleMapsLinkFor", () => {
  it("builds Google's documented search link with the address as the query", () => {
    const link = googleMapsLinkFor("1400 Meridian Way, Suite 300, Reno, NV 89501");
    expect(link).not.toBeNull();
    const url = new URL(link!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("1400 Meridian Way, Suite 300, Reno, NV 89501");
  });

  it("encodes characters that would otherwise end the query", () => {
    const url = new URL(googleMapsLinkFor("12 Oak & Ash #4, Springfield")!);
    expect(url.searchParams.get("query")).toBe("12 Oak & Ash #4, Springfield");
    expect(url.search).not.toContain("&Ash");
  });

  it("offers no link for a blank address", () => {
    expect(googleMapsLinkFor("   ")).toBeNull();
  });
});
