/*
 * The account section registry — data, not markup, mirroring the settings section registry
 * (src/lib/settings/settings-sections.ts): the account rail renders from one canonical list
 * instead of hand-edited links. Account Settings is the member's OWN identity and credentials
 * surface (reached from the profile menu), kept separate from /settings, which carries work and
 * firm preferences. Every section here is the member's own, so the rail shows a single "Account"
 * band — unlike settings, which bands by ownership across member / firm / platform.
 */

export interface AccountSection {
  /** URL segment and stable id, e.g. "profile" -> /account/profile. */
  readonly id: string;
  /** User-facing rail label — Title Case. */
  readonly label: string;
  /** The section's route. Always /account/{id}. */
  readonly href: string;
}

/** The single band header for the account rail (every section is the member's own). */
export const ACCOUNT_BAND_LABEL = "Account";

export const ACCOUNT_SECTIONS: readonly AccountSection[] = [
  { id: "profile", label: "Profile", href: "/account/profile" },
  { id: "security", label: "Security", href: "/account/security" },
];

/** The rail's render list, canonical order. */
export function accountSections(): readonly AccountSection[] {
  return ACCOUNT_SECTIONS;
}

/** True when `pathname` lives under the section (drives aria-current / the active accent). */
export function isCurrentAccountSection(section: AccountSection, pathname: string): boolean {
  return pathname === section.href || pathname.startsWith(`${section.href}/`);
}
