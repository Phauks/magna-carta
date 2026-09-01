/*
 * The Fixtures registry — staged display pages that showcase a design with plausible data while
 * the real, data-driven surface is still being built (as distinct from the Sitemap, which is the
 * live app's actual routes). These are curated: a fixture is a made-up but concrete URL you can
 * open to see the design.
 *
 * TO ADD A FIXTURE SET: append one group here. Derive its pages from the fixture data itself
 * (as the matters group does from matterFixtures) so the list can never drift from what exists;
 * a hand-written group is fine too when there's no data array behind it. New fixtures land here as
 * they're built — no other file needs to change.
 */
import { matterFixtures } from "$lib/matters/fixtures.ts";
import type { DevPageGroup } from "./dev-page.ts";

export const FIXTURE_GROUPS: readonly DevPageGroup[] = [
  {
    title: "Matters",
    pages: matterFixtures.map((matter) => ({
      label: matter.title,
      href: `/matters/${matter.id}/overview`,
      note:
        matter.matterNumber === null ? matter.status : `${matter.status} · ${matter.matterNumber}`,
    })),
  },
  {
    title: "Sign-in",
    pages: [
      {
        label: "Screen states",
        href: "/developer-console/sign-in-screens",
        note: "Every signed-out screen and state",
      },
    ],
  },
  {
    title: "Failures",
    pages: [
      {
        label: "Failure states",
        href: "/developer-console/failure-states",
        note: "Every failure shape, at all three scales",
      },
    ],
  },
  {
    title: "Document automation",
    pages: [
      {
        label: "Assemble a document",
        href: "/forms/assemble",
        note: "Field input area · sample data",
      },
    ],
  },
];
