/*
 * Shared shapes for the developer console's page listings — used by both the Sitemap (the live
 * app's real routes) and Fixtures (staged display pages). One link, and an optionally-titled
 * group of them.
 */
export interface DevPage {
  label: string;
  href: string;
  /** A short right-aligned note (status, kind) — optional. */
  note?: string;
}

export interface DevPageGroup {
  /** Omitted for an ungrouped list (the Sitemap is one flat group). */
  title?: string;
  pages: readonly DevPage[];
}
