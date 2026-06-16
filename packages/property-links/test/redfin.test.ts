import { describe, expect, it } from "vitest";
import { redfinProvider } from "../src/providers/redfin.ts";

describe("redfinProvider", () => {
  it("builds the ?location search URL (percent-encoded address)", () => {
    expect(
      redfinProvider.build({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("https://www.redfin.com/?location=123%20Main%20St%2C%20Reno%2C%20NV%2089501");
  });

  it("declares its id and label", () => {
    expect(redfinProvider.id).toBe("redfin");
    expect(redfinProvider.label).toBe("Redfin");
  });

  it("returns null when the reference is insufficient", () => {
    expect(redfinProvider.build({ region: "NV" })).toBeNull();
  });
});
