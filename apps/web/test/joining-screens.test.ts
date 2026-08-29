/*
 * The owner-settled copy on the joining screens, pinned to the screens themselves.
 *
 * Every sentence asserted here was decided once and is expensive to re-litigate: registration asks
 * about a person and never about a firm, which is the ordering the whole surface turns on; the founding
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

describe("the account screen", () => {
  const source = stripComments(screenSource("register-account-screen.svelte"));

  it("asks nothing about a firm", () => {
    // THE reflow, pinned. This screen registers a PERSON, so it carries no field and no choice
    // about a firm: that question is put afterwards, signed in, once there is somebody to ask it
    // of. Mentioning a firm in prose is fine and is not what this guards — the closing line
    // promises what comes next. What must never return is an INPUT or a control.
    const fields =
      source.match(/<Input[\s\S]*?\/>|<Label[\s\S]*?<\/Label>|<Button[\s\S]*?>/g) ?? [];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((field) => /firm/i.test(field))).toEqual([]);
  });

  it("names what pressing the button does, rather than the journey it begins", () => {
    expect(source).toContain("Send Confirmation Email");
    expect(source).not.toContain("Create Account<");
  });

  it("collects no credential", () => {
    // The password is set from the emailed link, which is the act that proves the mailbox. A
    // password field here would mint a credential before anybody had proven anything.
    expect(source).not.toContain('type="password"');
  });
});

describe("the joining choice screen", () => {
  const source = stripComments(screenSource("joining-choice-screen.svelte"));

  it("offers exactly the two things the server can do", () => {
    expect(source).toContain("Start a new law firm");
    expect(source).toContain("I have an invitation code");
  });

  it("renders what is unbuilt from the register, never as a control", () => {
    // A control that cannot work is worse than an absent one, and worse still than a present one
    // that says why it is inert. The sentences come from joining-availability.ts so that the day a
    // gap closes, one entry moves and this screen follows.
    expect(source).toContain("JOINING_STEPS");
    expect(source).toContain('reach === "unbuilt"');
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
