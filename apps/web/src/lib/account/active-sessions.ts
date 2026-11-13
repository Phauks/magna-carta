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
 *
 * AND ONE IT NO LONGER SPELLS OUT. A revoked session's device holds a signed cookie this deployment
 * believes for up to five minutes before it re-reads the session store (the cookie cache in
 * apps/api-worker/src/auth.ts), so a device signed out here can finish a request or two before it
 * is turned away. That fact is true and it used to open the screen as a standing notice — a
 * paragraph every reader paid for on every visit, about a delay most of them will never observe.
 * It came off with the rest of the account surface's explanatory small text (owner correction,
 * 2026-09-18). What replaced it is the remedy being present instead of described: Account ->
 * Security now changes a password in place, which invalidates what the stale cookie proves rather
 * than waiting for it to lapse. The delay is documented for readers in
 * docs/user/features/signed-in-devices.md.
 *
 * AN ADDRESS THE REQUEST DID NOT CARRY IS LEFT OUT, not named. A row that said "Address not
 * recorded" spent a line of every device's caption on a fact about our own plumbing, and it was on
 * every row, because the deployment was reading the wrong header — Cloudflare's client address
 * arrives as `cf-connecting-ip`, and Better Auth's default reads `x-forwarded-for` alone and
 * refuses a multi-hop value outright. The header is configured now (apps/api-worker/src/auth.ts),
 * so an address is the ordinary case; where one is genuinely absent the caption simply has one
 * fewer clause.
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

/** The list could not be read. Says nothing about whether the sessions exist. */
export const SESSIONS_UNAVAILABLE =
  "Your signed-in devices could not be listed. Try again, and if it keeps happening, contact your firm's administrator.";

/** A revocation the server refused or never answered. The session is assumed still live. */
export const REVOKE_FAILED =
  "That device couldn't be signed out and may still be signed in. Try again.";

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

//
// ONE LIMIT WORTH STATING RATHER THAN PAPERING OVER: an iPad on iPadOS 13 or later reports itself as
// `Macintosh; Intel Mac OS X` and is genuinely indistinguishable from a Mac in this string — Apple
// removed the difference deliberately. Such a row therefore reads "Safari on macOS". The `iPad`
// token below still earns its place (older iPads, and any iPad asked for the mobile site, do send
// it), but nothing here can recover the rest, and the honest recovery is not in the user agent at
// all: it is the browser telling us at sign-in. Until something does, a Mac-shaped iPad says Mac
// rather than being guessed into place — a wrong device name on this screen is worse than a vague
// one, because the whole screen is somebody deciding which row is not them.
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
 * `currentToken` may be null when the current session could not be identified. No row is then
 * marked — and that is NOT merely a missing badge, which is what this comment used to claim. The
 * badge is also what tells the screen which row it must not offer to end: unmarked, the reader's own
 * session grows a Sign out button that works, and using it leaves them browsing a session the server
 * has already deleted, still believed for the length of the cookie cache. So the page treats an
 * unidentifiable current session as a reason to withhold the per-row action entirely
 * ({@link canEndIndividualSessions}), rather than as a cosmetic loss.
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
 * Whether the screen may offer to end ONE named session.
 *
 * It may only when it knows which row is the reader's own. With no row marked, every button on the
 * screen is a button that might end the session pressing it — and the press would appear to work:
 * the server deletes the row, and the cookie cache goes on believing the session for its five
 * minutes, so the reader carries on until the application starts refusing them for no stated reason.
 *
 * "Sign out everywhere else" is deliberately NOT gated on this. The server resolves "everywhere
 * else" from the request's own session rather than from anything this screen sends, so it cannot
 * end the caller's session whatever the screen believes — which makes it exactly the control to
 * leave standing when the screen's own knowledge is the thing that failed.
 */
export function canEndIndividualSessions(rows: readonly ActiveSessionRow[]): boolean {
  return rows.some((row) => row.isCurrent);
}

/**
 * What to say after signing other devices out. The count is stated because it is the confirmation:
 * a person who expected one other device and is told four has learned the thing this screen exists
 * to tell them.
 */
export function signedOutElsewhereMessage(count: number | null): string {
  // A null count is the screen admitting it could not identify its own row, so it does not know how
  // many of the rows it listed were "other". It says the act succeeded and states no number: the
  // count is the confirmation, and a confirmation that might be off by one is not one.
  if (count === null) return "Signed out of your other devices.";
  if (count <= 0) return "There were no other devices to sign out.";
  return count === 1 ? "Signed out of 1 other device." : `Signed out of ${count} other devices.`;
}
