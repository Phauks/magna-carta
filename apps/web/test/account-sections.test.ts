/*
 * Well-formedness of the account nav registry — the account analogue of the settings
 * mode-purity check: pure data, node, no browser. Guards that the rail always renders a
 * consistent, collision-free set of sections whose hrefs match their routes.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SECTIONS,
  accountSections,
  isCurrentAccountSection,
} from "../src/lib/account/account-sections.ts";

describe("account section registry", () => {
  it("lists Profile, Security then Active Sessions in canonical order", () => {
    expect(accountSections().map((section) => section.id)).toEqual([
      "profile",
      "security",
      "sessions",
    ]);
  });

  it("gives every section a unique id", () => {
    const ids = ACCOUNT_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every section a unique href under /account", () => {
    const hrefs = ACCOUNT_SECTIONS.map((section) => section.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/account/")).toBe(true);
  });

  it("derives each href from its id", () => {
    for (const section of ACCOUNT_SECTIONS) {
      expect(section.href).toBe(`/account/${section.id}`);
    }
  });

  it("marks the active section by exact path and by nested path", () => {
    const profile = ACCOUNT_SECTIONS[0]!;
    expect(isCurrentAccountSection(profile, "/account/profile")).toBe(true);
    expect(isCurrentAccountSection(profile, "/account/profile/anything")).toBe(true);
    expect(isCurrentAccountSection(profile, "/account/security")).toBe(false);
  });
});
