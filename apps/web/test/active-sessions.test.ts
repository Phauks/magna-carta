/*
 * The signed-in-devices reading (src/lib/account/active-sessions.ts) — pure data, node, no browser.
 * What is pinned here is the judgement rather than the layout: which device a user agent names,
 * which row is this one, and what order they come in.
 *
 * THE SCREEN'S TWO STANDING SENTENCES USED TO BE PINNED HERE and are deliberately gone with them
 * (owner correction, 2026-09-18): the revocation-lag notice and the "Address not recorded" caption
 * both explained our own plumbing to every reader on every visit. What replaced the first is a
 * control — Account -> Security changes a password in place — and what replaced the second is the
 * deployment reading the header Cloudflare actually sends. A caption for a fact the row does not
 * carry is now an absent clause, which the row-shape cases below pin as a null.
 */
import { describe, expect, it } from "vitest";
import {
  activeSessionRows,
  canEndIndividualSessions,
  describeDevice,
  otherDeviceRows,
  signedOutElsewhereMessage,
  UNKNOWN_DEVICE,
  type ActiveSessionRecord,
} from "../src/lib/account/active-sessions.ts";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/140.0.0.0`;
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0";

function session(overrides: Partial<ActiveSessionRecord> = {}): ActiveSessionRecord {
  return {
    token: "ses_one",
    createdAt: "2026-09-01T09:00:00.000Z",
    expiresAt: "2026-10-01T09:00:00.000Z",
    ipAddress: "203.0.113.7",
    userAgent: CHROME_WINDOWS,
    ...overrides,
  };
}

describe("naming the device behind a user agent", () => {
  it("names the browser and the platform together", () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe("Chrome on Windows");
    expect(describeDevice(FIREFOX_MAC)).toBe("Firefox on macOS");
  });

  // Order is the logic: every Chromium browser claims to be Chrome, and Chrome claims to be Safari.
  it("reads the most specific browser claim, not the first one in the string", () => {
    expect(describeDevice(EDGE_WINDOWS)).toBe("Edge on Windows");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari on iPhone");
  });

  it("says so rather than guessing when nothing is recognisable", () => {
    expect(describeDevice("curl/8.5.0")).toBe(UNKNOWN_DEVICE);
    expect(describeDevice(null)).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("")).toBe(UNKNOWN_DEVICE);
  });

  it("names whichever half it does recognise", () => {
    expect(describeDevice("Something/1.0 (Linux)")).toBe("Linux");
  });
});

describe("the rows the screen renders", () => {
  it("puts this device first, then the rest newest first", () => {
    const rows = activeSessionRows(
      [
        session({ token: "ses_old", createdAt: "2026-08-01T09:00:00.000Z" }),
        session({ token: "ses_new", createdAt: "2026-09-05T09:00:00.000Z" }),
        session({ token: "ses_here", createdAt: "2026-07-01T09:00:00.000Z" }),
      ],
      "ses_here",
    );

    expect(rows.map((row) => row.token)).toEqual(["ses_here", "ses_new", "ses_old"]);
    expect(rows.map((row) => row.isCurrent)).toEqual([true, false, false]);
  });

  // THE SHAPE THAT ACTUALLY ARRIVES. Better Auth's browser client revives ISO strings into Date
  // objects before a caller sees them, so the ordering has to hold for Dates as well as strings —
  // a string-only reading sorts every row with NaN and looks stable while being arbitrary.
  it("orders rows the same when the instants arrive as Date objects", () => {
    const rows = activeSessionRows(
      [
        session({ token: "ses_old", createdAt: new Date("2026-08-01T09:00:00.000Z") }),
        session({ token: "ses_new", createdAt: new Date("2026-09-05T09:00:00.000Z") }),
      ],
      null,
    );
    expect(rows.map((row) => row.token)).toEqual(["ses_new", "ses_old"]);
  });

  // The badge is worth losing; labelling somebody else's laptop "This device" is not.
  it("marks no row when the current session could not be identified", () => {
    const rows = activeSessionRows([session(), session({ token: "ses_two" })], null);
    expect(rows.some((row) => row.isCurrent)).toBe(false);
  });

  // Null rather than a sentence: the screen leaves the clause out entirely, so what the row owes it
  // is the absence itself. An empty string counts as absent — a recorded address that is no address
  // would otherwise render as a stray separator with nothing after it.
  it("carries an absent address through as null for the screen to leave out", () => {
    expect(activeSessionRows([session({ ipAddress: null })], null)[0]?.ipAddress).toBeNull();
    expect(activeSessionRows([session({ ipAddress: "" })], null)[0]?.ipAddress).toBeNull();
    expect(activeSessionRows([session({ ipAddress: undefined })], null)[0]?.ipAddress).toBeNull();
  });

  it("carries a recorded address through as it arrived", () => {
    expect(activeSessionRows([session({ ipAddress: "203.0.113.7" })], null)[0]?.ipAddress).toBe(
      "203.0.113.7",
    );
  });

  it("does not mutate the list it was given", () => {
    const sessions = [
      session({ token: "ses_a", createdAt: "2026-08-01T09:00:00.000Z" }),
      session({ token: "ses_b", createdAt: "2026-09-01T09:00:00.000Z" }),
    ];
    activeSessionRows(sessions, "ses_b");
    expect(sessions.map((one) => one.token)).toEqual(["ses_a", "ses_b"]);
  });

  // THE SAFETY THIS UNMARKED CASE ACTUALLY COSTS. With no row known to be this device, a per-row
  // Sign out is a button that might end the session pressing it — and it would look like it worked,
  // because the cookie cache keeps believing the deleted session for its five minutes. So the
  // screen withholds the per-row action rather than offering a coin flip.
  it("refuses individual sign-out when this device is not among the marked rows", () => {
    const unknown = activeSessionRows([session(), session({ token: "ses_two" })], null);
    expect(canEndIndividualSessions(unknown)).toBe(false);

    const known = activeSessionRows([session(), session({ token: "ses_two" })], "ses_two");
    expect(canEndIndividualSessions(known)).toBe(true);
  });

  it("counts every row but this one as somewhere else", () => {
    const rows = activeSessionRows(
      [session({ token: "ses_here" }), session({ token: "ses_two" }), session({ token: "ses_3" })],
      "ses_here",
    );
    expect(otherDeviceRows(rows).map((row) => row.token)).toEqual(["ses_two", "ses_3"]);
  });
});

describe("what the screen says", () => {
  it("states the count after signing other devices out, singular and plural", () => {
    expect(signedOutElsewhereMessage(1)).toBe("Signed out of 1 other device.");
    expect(signedOutElsewhereMessage(4)).toBe("Signed out of 4 other devices.");
    expect(signedOutElsewhereMessage(0)).toContain("no other devices");
  });

  // The count is the confirmation — a person who expected one other device and is told four has
  // learned the thing this screen exists to tell them. So a count the screen cannot stand behind
  // (this device unidentified, so "other" is unknowable) is omitted rather than guessed.
  it("states no count when the screen could not tell which row was its own", () => {
    const message = signedOutElsewhereMessage(null);
    expect(message).toBe("Signed out of your other devices.");
    expect(message).not.toMatch(/\d/);
  });
});
