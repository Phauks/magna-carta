/*
 * The guard on the property the whole redemption design turns on: ONE refusal, never a per-field
 * one.
 *
 * The server cannot say which of the code, the surname or the date of birth was wrong — the row
 * holds a single digest over all three — so the only way that property can be lost is on this side
 * of the wire, by a well-meaning change that marks one field and not the others, or gives one field
 * its own message. Both are the obvious kindness, and both turn the form into a machine for
 * confirming that a named person was invited to a named firm.
 *
 * A comment asking a future contributor not to do that is not a guard. This is: it reads the screen
 * and the page and asserts that the invalid mark is driven by ONE value applied to every field, and
 * that neither file grew a second rejection to put beside it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCREEN = join(import.meta.dirname, "../src/lib/auth/screens/redeem-invitation-screen.svelte");
const PAGE = join(import.meta.dirname, "../src/routes/register/invitation/+page.svelte");

const screenSource = readFileSync(SCREEN, "utf8");
const pageSource = readFileSync(PAGE, "utf8");

/** Strip comment prose so the sweep reads only rendered markup and live code. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const screenCode = stripComments(screenSource);
const pageCode = stripComments(pageSource);

describe("the invitation screen refuses as one", () => {
  it("marks all three fields from the same single value", () => {
    const marks = [...screenCode.matchAll(/aria-invalid=\{([^}]*)\}/g)].map((hit) => hit[1]);
    expect(marks).toHaveLength(3);
    expect(new Set(marks).size).toBe(1);
  });

  it("takes exactly one rejection prop, with no per-field sibling", () => {
    const rejectionProps = [...screenCode.matchAll(/\brejection\b/g)];
    expect(rejectionProps.length).toBeGreaterThan(0);
    for (const fact of ["codeRejection", "lastNameRejection", "dateOfBirthRejection"]) {
      expect(screenCode).not.toContain(fact);
    }
  });

  it("never names one of the three facts on its own in the screen's live copy", () => {
    // The refusal lists all three or it is not neutral. What must never appear is a rendered
    // sentence about a single fact, which is what a field-level verdict reads as.
    for (const singling of [
      "code is",
      "code was",
      "code doesn't",
      "last name is",
      "last name doesn't",
      "date of birth is",
      "date of birth doesn't",
    ]) {
      expect(screenCode.toLowerCase()).not.toContain(singling);
    }
  });
});

describe("the invitation page refuses as one", () => {
  it("branches on the outcome, never on which fact the server blamed", () => {
    // The problem document carries no field, and nothing here may invent one by reading `detail`.
    expect(pageCode).not.toContain("problem.detail");
    expect(pageCode).not.toContain("problem.type");
  });

  it("holds exactly one rejection", () => {
    const declarations = [...pageCode.matchAll(/let\s+\w*[Rr]ejection\w*\s*=\s*\$state/g)];
    expect(declarations).toHaveLength(1);
  });
});
