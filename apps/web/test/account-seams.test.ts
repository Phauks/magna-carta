/*
 * The account honest-seam guard — the CI teeth behind "no account control functions before its
 * backend does", and now behind the other half of the same promise: no account page claims a seam
 * it no longer has. A source scan (the node pool cannot render Svelte, so this mirrors the
 * canvas-ink-purity fitness check).
 *
 * THERE ARE NO SEAMS LEFT. The four rows this guard was written for — the member's name, their
 * picture, their password and two-factor — are all built; two-factor was the last, on 2026-09-24.
 * The guard stays for the direction it can still catch: a Soon badge on a page where everything
 * works is a promise about nothing, and a disabled control waiting on a backend that has shipped is
 * a dead control a member presses and wonders about. If a new account row arrives as a seam, it is
 * added to a list here that tests it is badged and disabled — the shape the earlier version of this
 * file had, in git history.
 *
 * Active Sessions (routes/account/sessions) is absent on purpose: it is a built surface over Better
 * Auth's own list and revoke routes, with live controls that are supposed to be live, and its
 * behaviour is pinned by test/active-sessions.test.ts instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The account pages built on the settings row grid. */
const ACCOUNT_PAGES: readonly string[] = [
  "src/routes/account/profile/+page.svelte",
  "src/routes/account/security/+page.svelte",
];

const SOON_BADGE = '<Badge variant="neutral">Soon</Badge>';

/** Every seam control on this surface was named "<row> (arrives with …)". */
const SEAM_CONTROL = /aria-label="[^"]*\(arrives[^"]*"/;

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf-8");
}

describe("account honest-seam guard", () => {
  it.each(ACCOUNT_PAGES)("claims no Soon badge on %s", (page) => {
    expect(read(page), `${page} badges a seam it no longer has`).not.toContain(SOON_BADGE);
  });

  it.each(ACCOUNT_PAGES)("carries no control waiting on a backend on %s", (page) => {
    expect(read(page), `${page} still names a seam control`).not.toMatch(SEAM_CONTROL);
  });

  // The account rows are page-local SettingDefinitions rendered through the shared grid. A
  // draft/instant posture would bind them to the settings draft store, which keeps a per-browser
  // copy — the wrong home for an account fact, which is the server's.
  it("takes no live-write posture on any SettingsRow", () => {
    const offenders = ACCOUNT_PAGES.filter((page) =>
      /<SettingsRow[^>]*\b(draft|instant)=/.test(read(page)),
    );
    expect(
      offenders,
      `account rows carry their own commit, never the settings draft:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
