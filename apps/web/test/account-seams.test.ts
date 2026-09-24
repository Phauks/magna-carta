/*
 * The account honest-seam guard — the CI teeth behind "no account control functions before its
 * backend does". A source scan (the node pool cannot render Svelte, so this mirrors the
 * canvas-ink-purity fitness check): every interactive control on a SEAM page must be disabled, no
 * SettingsRow may take a live-write posture (a draft/instant prop), and each page must carry the
 * Soon badge. A real control landing there fails this test until someone updates it deliberately.
 *
 * PAGES IS THE LIST OF SEAM PAGES, NOT OF ACCOUNT PAGES, and the difference is the point. Active
 * Sessions (routes/account/sessions) is deliberately absent: it is a built surface over Better
 * Auth's own list and revoke routes, with live controls that are supposed to be live, and its
 * behaviour is pinned by test/active-sessions.test.ts instead. A page leaves this list when its
 * backend lands — never to quiet a failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGES = [
  "src/http/routes/account/profile/+page.svelte",
  "src/http/routes/account/security/+page.svelte",
];

function read(relativePath: string): string {
  return readFileSync(join(import.meta.dirname, "..", relativePath), "utf-8");
}

// Opening tags of interactive design-system controls, captured up to the first ">".
const CONTROL_TAG = /<(Input|Switch|Select\.Root|Button)\b[^>]*>/g;

describe("account honest-seam guard", () => {
  it("disables every interactive control on every account page", () => {
    const offenders: string[] = [];
    for (const relativePath of PAGES) {
      const source = read(relativePath);
      for (const match of source.matchAll(CONTROL_TAG)) {
        if (!/\bdisabled\b/.test(match[0])) {
          offenders.push(`${relativePath} — ${match[0]}`);
        }
      }
    }
    expect(offenders, `enabled controls break the pre-auth seam:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("takes no live-write posture on any SettingsRow", () => {
    const offenders: string[] = [];
    for (const relativePath of PAGES) {
      const source = read(relativePath);
      // draft= / instant= are the SettingsRow posture props that bind a live value.
      if (/<SettingsRow[^>]*\b(draft|instant)=/.test(source)) offenders.push(relativePath);
    }
    expect(
      offenders,
      `account rows must stay seams (no draft/instant posture):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("carries the Soon badge on every account page", () => {
    for (const relativePath of PAGES) {
      expect(read(relativePath), `${relativePath} has no Soon seam`).toContain(
        '<Badge variant="neutral">Soon</Badge>',
      );
    }
  });
});
