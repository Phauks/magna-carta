import { describe, expect, it } from "vitest";
import { googleMapsProvider } from "../src/providers/google-maps.ts";

describe("googleMapsProvider", () => {
  it("builds the official Maps URLs API search link", () => {
    expect(
      googleMapsProvider.build({
        street: "123 Main St",
        city: "Reno",
        region: "NV",
        postal: "89501",
      }),
    ).toBe(
      "https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Reno%2C%20NV%2089501",
    );
  });

  it("declares its id and label", () => {
    expect(googleMapsProvider.id).toBe("googleMaps");
    expect(googleMapsProvider.label).toBe("Google Maps");
  });

  it("returns null when the reference is insufficient", () => {
    expect(googleMapsProvider.build({ region: "NV" })).toBeNull();
  });
});
