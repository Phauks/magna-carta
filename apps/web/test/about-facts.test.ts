/*
 * The About window's facts and its clipboard block (src/lib/about/about-facts.ts): pure data, node,
 * no browser.
 */
import { describe, expect, it } from "vitest";
import {
  aboutDetailsText,
  aboutFacts,
  type AboutFactsInput,
} from "../src/lib/about/about-facts.ts";

const CHROME_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const SIGNED_IN: AboutFactsInput = {
  commit: "934416b",
  releasedAt: "2026-11-09T18:00:00.000Z",
  mode: "production",
  memberName: "Rosalind Chase",
  firmName: "Chase & Whitfield LLP",
  userAgent: CHROME_ON_MAC,
};

function environmentFor(mode: string): string | undefined {
  return aboutFacts({ ...SIGNED_IN, mode }).find((fact) => fact.term === "Environment")?.value;
}

describe("aboutFacts", () => {
  it("states the version, release, member, firm, environment and browser in that order", () => {
    expect(aboutFacts(SIGNED_IN).map((fact) => fact.term)).toEqual([
      "Version",
      "Released",
      "Signed in as",
      "Firm",
      "Environment",
      "Browser",
    ]);
  });

  it("names production outright and a preview by its mode", () => {
    expect(environmentFor("production")).toBe("Production");
    expect(environmentFor("development")).toBe("Development");
    expect(environmentFor("preview")).toBe("Preview");
  });

  it("describes the browser from its user agent", () => {
    expect(aboutFacts(SIGNED_IN).find((fact) => fact.term === "Browser")?.value).toBe(
      "Chrome on macOS",
    );
  });

  it("leaves out the member and firm rather than showing a placeholder when they are not known", () => {
    const terms = aboutFacts({ ...SIGNED_IN, memberName: null, firmName: null }).map(
      (fact) => fact.term,
    );
    expect(terms).not.toContain("Signed in as");
    expect(terms).not.toContain("Firm");
  });
});

describe("aboutDetailsText", () => {
  it("is a title line followed by one line per fact", () => {
    const lines = aboutDetailsText(aboutFacts(SIGNED_IN)).split("\n");
    expect(lines[0]).toBe("Magna Carta");
    expect(lines[1]).toBe("Version: 934416b");
    expect(lines).toContain("Firm: Chase & Whitfield LLP");
    expect(lines.at(-1)).toBe("Browser: Chrome on macOS");
  });
});
