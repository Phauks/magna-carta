/*
 * The owner-settled copy on the joining screens, pinned to the screens themselves.
 *
 * Every sentence asserted here was decided once and is expensive to re-litigate: the three doors are
 * the sentences a person would say about themselves rather than a list of role nouns; the founding
 * details screen is titled for the person being registered and not for a rank; the button names the
 * act it performs rather than the journey it begins; and the invitation code field carries no
 * generated prefix, because the generator emits none and one typed in would normalize into the
 * digest and refuse every real code.
 *
 * These read the SOURCE rather than rendering the components, which is a limitation of where the web
 * app's tests run rather than a preference: this project uses a plain node pool, and rendering a
 * design-system component pulls bits-ui, which a deliberate boundary gate keeps out of every config
 * outside the design system (packages/design-system/test/fitness/boundaries.test.ts). The catalog's
 * own browser-mode stories are where rendered behaviour is asserted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCREENS = join(import.meta.dirname, "../src/lib/auth/screens");

function screenSource(name: string): string {
  return readFileSync(join(SCREENS, name), "utf8");
}

/** Strip comment prose so a sweep reads only what the screen renders. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("the three doors", () => {
  const source = stripComments(screenSource("register-screen.svelte"));

  it("reads in the owner's words, in order", () => {
    const positions = [
      "I am a client at a law firm",
      "I work at a law firm",
      "I want to start a new law firm",
    ].map((door) => source.indexOf(door));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
  });

  it("sends both invited doors to the same place", () => {
    // Only the founding door creates anything; membership of an existing firm is that firm's
    // decision, so a second destination here would be a second way into somebody else's firm.
    expect(source).toContain('role: "clientOfFirm"');
    expect(source).toContain('role: "firmMember"');
    expect(source).toContain('role: "foundFirm"');
  });
});

describe("the founding details screen", () => {
  const source = stripComments(screenSource("register-details-screen.svelte"));

  it("is titled for the person being registered, never for a founding rank", () => {
    expect(source).toContain('title="Register New User"');
    expect(source).not.toContain("Founding Member");
  });

  it("names the act the button performs rather than the journey it starts", () => {
    // The route answers 202 and mails a token; nothing is created until that token is spent.
    expect(source).toContain("Send Confirmation Email");
    expect(source).not.toContain("Create Account");
  });

  it("asks for no credential, because the password is set from the emailed link", () => {
    expect(source).not.toContain('type="password"');
    expect(source).not.toContain("Passkey");
  });

  it("gates the submit on both acknowledgements", () => {
    expect(source).toContain("agreedToTerms &&");
    expect(source).toContain("agreedToPrivacy");
  });
});

describe("the invitation screen", () => {
  const source = stripComments(screenSource("redeem-invitation-screen.svelte"));

  it("asks for exactly the three facts the route takes, each with a title above it", () => {
    for (const [id, title] of [
      ["invitation-code", "Invitation Code"],
      ["invitation-last-name", "Last Name"],
      ["invitation-date-of-birth", "Date of Birth"],
    ] as const) {
      expect(source).toContain(`for="${id}"`);
      expect(source).toContain(`id="${id}"`);
      expect(source).toContain(`>${title}</Label>`);
    }
  });

  it("carries ghost text as well as the title on the two typed fields", () => {
    // The name has to survive the first keystroke; the date field's hints are the browser's own.
    expect(source).toContain('placeholder="Invitation Code"');
    expect(source).toContain('placeholder="Last Name"');
  });

  it("names the date field for the fact it holds, and lets a browser fill it", () => {
    expect(source).toContain(">Date of Birth</Label>");
    expect(source).toContain('autocomplete="bday"');
  });

  it("puts no generated prefix in the code field", () => {
    expect(source).not.toContain("MCINV");
  });
});

describe("the screens that end a journey", () => {
  it("offers no resend, because nothing on the server resends", () => {
    const source = stripComments(screenSource("check-email-screen.svelte"));
    expect(source).not.toContain("Send Again");
    expect(source).not.toContain("Resend");
    // The honest alternative takes its place, supplied by the caller per door.
    expect(source).toContain("{remedy}");
  });

  it("writes the send time out through the full-date stamp rather than inline", () => {
    const source = stripComments(screenSource("check-email-screen.svelte"));
    expect(source).toContain("sentStamp(sentAt)");
    expect(source).not.toContain("toLocaleDateString");
  });

  it("takes the emailed token in a field of its own and names the act", () => {
    const source = stripComments(screenSource("confirm-registration-screen.svelte"));
    expect(source).toContain('id="registration-confirmation-code"');
    expect(source).toContain(">Confirmation Code</Label>");
    expect(source).toContain("Confirm Email Address");
  });
});
