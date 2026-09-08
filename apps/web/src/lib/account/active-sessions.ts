/*
 * Active sessions — the reading of a session row, and the sentences the surface says about it.
 *
 * Pure, because everything worth getting right here is a judgement rather than a layout: which
 * device a user agent names, which row is the one being read on, what order the rows come in, and
 * what a person is told when a sign-out on another device does not take effect immediately. The
 * page (routes/account/sessions/+page.svelte) makes the calls; this module decides what they mean.
 *
 * ONE FACT THIS SCREEN DELIBERATELY DOES NOT SHOW: "last active". The session row carries an
 * `updatedAt`, and it reads like a last-seen stamp and is not one — Better Auth only rewrites it
 * when it refreshes a session, which under this deployment's five-minute signed-cookie cache
 * (apps/api-worker/src/auth.ts) happens on a scale of days rather than of use. A stamp that says
 * "active 3 days ago" for a device somebody is holding is worse than no stamp, because the whole
 * point of this screen is deciding which row is an intruder. So the screen states when a session
 * was ESTABLISHED and when it expires, both of which the row knows exactly.
 */
import { readInstant, type Instant } from "@magna-carta/design-system/formatters";

/**
 * A session as `/api/auth/list-sessions` hands one back.
 *
 * The instants are typed as `Instant` rather than as strings BECAUSE THE WIRE FORMAT IS NOT WHAT
 * ARRIVES: Better Auth's browser client parses its responses through its own JSON reader, which
 * revives any ISO-8601 string into a real `Date` before a caller ever sees it. Declaring these
 * `string` type-checks fine and then sorts every row into place with `NaN`, which reads as a
 * stable order and is not one. Accepting both forms is also what lets a test state the fixture as
 * a string.
 */
export interface ActiveSessionRecord {
  readonly token: string;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/** One row on the screen. */
export interface ActiveSessionRow {
  /** The session's own token — what a revocation is addressed by. */
  readonly token: string;
  /** The device, as far as the user agent admits it. */
  readonly device: string;
  /** Where it signed in from, or null when the request carried no address. */
  readonly ipAddress: string | null;
  /** When this session was established. */
  readonly signedInAt: Instant;
  /** When it lapses on its own. */
  readonly expiresAt: Instant;
  /** True for the session this screen is being read on — the one row with no Sign out button. */
  readonly isCurrent: boolean;
}

/** Shown for a device that this session was signed in from. */
export const THIS_DEVICE = "This device";

/** A user agent that names nothing recognisable. Never guessed at. */
export const UNKNOWN_DEVICE = "Unrecognised device";

/** A session whose request carried no client address. */
export const UNRECORDED_ADDRESS = "Address not recorded";

/** The list could not be read. Says nothing about whether the sessions exist. */
export const SESSIONS_UNAVAILABLE =
  "Your signed-in devices could not be listed. Try again, and if it keeps happening, contact your firm's administrator.";

/** A revocation the server refused or never answered. The session is assumed still live. */
export const REVOKE_FAILED =
  "That device could not be signed out — it may still be signed in. Try again.";

/**
 * THE HONEST LAG, stated on the screen rather than left to be discovered. A revoked session's
 * device holds a signed cookie that this deployment believes for up to five minutes before it
 * re-reads the session store (the cookie cache in apps/api-worker/src/auth.ts), so a device signed
 * out here can finish a request or two before it is turned away. Somebody using this screen because
 * they believe an account is compromised needs that fact in front of them — it is the difference
 * between "it did not work" and "wait a moment" — and it is also why the sentence names a password
 * change, which invalidates what the cookie proves rather than waiting for it to lapse.
 */
export const REVOCATION_LAG_NOTE =
  "A device signed out here can take up to five minutes to be turned away. If you think somebody else has your account, change your password as well.";

/*
 * USER AGENT → DEVICE, in the only way this is honestly done: a short table of exact tokens, tried
 * most-specific first, with anything unmatched named as unrecognised rather than guessed at. Every
 * Chromium browser claims to be Chrome and Chrome claims to be Safari, so ORDER IS THE LOGIC here —
 * Edge before Chrome, Chrome before Safari — and a new entry goes in at its specificity, not at the
 * end. This is deliberately not a user-agent parsing library: the string is a hint the screen shows
 * so a person recognises their own laptop, nothing depends on it, and a dependency that ships a
 * quarterly-updated device database to decide a row's caption is not a trade worth making.
 */
const BROWSERS: readonly (readonly [token: string, name: string])[] = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const PLATFORMS: readonly (readonly [token: string, name: string])[] = [
  ["Windows", "Windows"],
  ["Android", "Android"],
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Mac OS X", "macOS"],
  ["Linux", "Linux"],
];

function firstMatch(
  userAgent: string,
  table: readonly (readonly [string, string])[],
): string | null {
  return table.find(([token]) => userAgent.includes(token))?.[1] ?? null;
}

/**
 * What to call the device behind a user agent: "Chrome on Windows", "Safari on iPhone", the browser
 * or the platform alone when only one is recognisable, and {@link UNKNOWN_DEVICE} when neither is.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined || userAgent.trim() === "") {
    return UNKNOWN_DEVICE;
  }
  const browser = firstMatch(userAgent, BROWSERS);
  const platform = firstMatch(userAgent, PLATFORMS);
  if (browser !== null && platform !== null) return `${browser} on ${platform}`;
  return browser ?? platform ?? UNKNOWN_DEVICE;
}

/**
 * The screen's rows, in reading order: THIS device first — it is the one row whose identity the
 * reader already knows, and putting it at the top is what makes every row below it "somewhere
 * else" — then the rest newest first, because a session somebody did not expect is far likelier to
 * be a recent one than an old one.
 *
 * `currentToken` may be null when the current session could not be identified; no row is then
 * marked, which costs a badge and never mislabels somebody else's device as this one.
 */
export function activeSessionRows(
  sessions: readonly ActiveSessionRecord[],
  currentToken: string | null,
): ActiveSessionRow[] {
  return sessions
    .map((session) => ({
      token: session.token,
      device: describeDevice(session.userAgent),
      ipAddress:
        session.ipAddress === null || session.ipAddress === undefined || session.ipAddress === ""
          ? null
          : session.ipAddress,
      signedInAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: currentToken !== null && session.token === currentToken,
    }))
    .toSorted((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      // An unreadable instant sorts as 0 rather than dragging the row to an end of the list: the
      // row is still a device somebody has to be able to sign out.
      return (
        (readInstant(right.signedInAt)?.getTime() ?? 0) -
        (readInstant(left.signedInAt)?.getTime() ?? 0)
      );
    });
}

/** The rows that are not this device — what "sign out everywhere else" acts on. */
export function otherDeviceRows(rows: readonly ActiveSessionRow[]): ActiveSessionRow[] {
  return rows.filter((row) => !row.isCurrent);
}

/**
 * What to say after signing other devices out. The count is stated because it is the confirmation:
 * a person who expected one other device and is told four has learned the thing this screen exists
 * to tell them.
 */
export function signedOutElsewhereMessage(count: number): string {
  if (count <= 0) return "There were no other devices to sign out.";
  return count === 1 ? "Signed out of 1 other device." : `Signed out of ${count} other devices.`;
}
