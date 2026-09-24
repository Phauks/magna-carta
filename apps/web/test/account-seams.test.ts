/*
 * The account honest-seam guard — the CI teeth behind "no account control functions before its
 * backend does". A source scan (the node pool cannot render Svelte, so this mirrors the
 * canvas-ink-purity fitness check).
 *
 * WHAT IS LEFT OF THE SEAM. Three of the four rows this guard was written for are built now: the
 * member's name, their picture, and their password. Two-factor is the one that remains, and it is
 * the reason the guard does too — a seam that quietly grows a working control is exactly the thing
 * a reviewer does not notice, and the Soon badge is the promise this test keeps.
 *
 * SO THE RULE IS NOW WRITTEN AROUND THE SEAM ROWS RATHER THAN THE PAGES. The earlier version
 * disabled every control on a page that carried any seam, which was right while the pages were
 * ENTIRELY seams and became wrong the moment one row on them worked: it would have failed the
 * password change for existing. What it tests instead is that each named seam still reads as one —
 * its control disabled, beside the badge that says why — and that a page carrying no seam claims no
 * Soon badge, which is the other half of the lie this guard exists to prevent.
 *
 * Active Sessions (routes/account/sessions) is absent from both lists on purpose: it is a built
 * surface over Better Auth's own list and revoke routes, with live controls that are supposed to be
 * live, and its behaviour is pinned by test/active-sessions.test.ts instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every account page that still carries at least one seam row, and what the seam is. */
const PAGES_WITH_SEAMS: ReadonlyArray<{ readonly page: string; readonly seam: string }> = [
  { page: "src/routes/account/security/+page.svelte", seam: "Two-Factor" },
];

/** Account pages on which nothing is a seam any more. */
const PAGES_WITHOUT_SEAMS: readonly string[] = ["src/routes/account/profile/+page.svelte"];

const SOON_BADGE = '<Badge variant="neutral">Soon</Badge>';

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf-8");
}

describe("account honest-seam guard", () => {
  it.each(PAGES_WITH_SEAMS)("keeps $seam a badged, disabled seam on $page", ({ page, seam }) => {
    const source = read(page);
    expect(source, `${page} has no Soon badge`).toContain(SOON_BADGE);

    // The seam's own control, found by the accessible name every seam control on this surface
    // carries: the row's label, then the parenthetical naming what it waits on.
    const control = new RegExp(`<[A-Za-z.]+[^>]*aria-label="${seam} \\(arrives[^"]*"[^>]*>`);
    const match = control.exec(source);
    expect(match, `${page} states no ${seam} seam control`).not.toBeNull();
    expect(match?.[0], `${seam} on ${page} is a working control behind a Soon badge`).toMatch(
      /\bdisabled\b/,
    );
  });

  // A Soon badge on a page where everything works is a promise about nothing, and it teaches a
  // reader that the badge means less than it does.
  it.each(PAGES_WITHOUT_SEAMS)("claims no Soon badge on %s", (page) => {
    expect(read(page), `${page} badges a seam it no longer has`).not.toContain(SOON_BADGE);
  });

  // The account rows are page-local SettingDefinitions rendered through the shared grid. A
  // draft/instant posture would bind them to the settings draft store, which keeps a per-browser
  // copy — the wrong home for an account fact, which is the server's.
  it("takes no live-write posture on any SettingsRow", () => {
    const offenders = [
      ...PAGES_WITH_SEAMS.map((entry) => entry.page),
      ...PAGES_WITHOUT_SEAMS,
    ].filter((page) => /<SettingsRow[^>]*\b(draft|instant)=/.test(read(page)));
    expect(
      offenders,
      `account rows carry their own commit, never the settings draft:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
