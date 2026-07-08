/*
 * The developer sitemap registry — fixture and dev-only pages worth reaching directly while the
 * real surfaces are still being built, so the design is showable when the files that would drive
 * it are lacking. Grouped, so new categories drop in here without touching the module that renders
 * them. The matter fixtures are derived from the fixture set itself, so this list never drifts
 * from what actually exists.
 */
import { matterFixtures } from "$lib/matters/fixtures.ts";

export interface DevPage {
  label: string;
  href: string;
  /** A short right-aligned note (status, kind) — optional. */
  note?: string;
}

export interface DevPageGroup {
  title: string;
  pages: readonly DevPage[];
}

export const DEV_PAGE_GROUPS: readonly DevPageGroup[] = [
  {
    title: "Matter fixtures",
    pages: matterFixtures.map((matter) => ({
      label: matter.title,
      href: `/matters/${matter.id}/overview`,
      note:
        matter.matterNumber === null ? matter.status : `${matter.status} · ${matter.matterNumber}`,
    })),
  },
];
