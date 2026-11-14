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
    title: "Design reviews",
    pages: [
      {
        label: "Pane toggle placements",
        href: "/developer-console/pane-toggle-placements",
        note: "Where the show/hide-a-pane control could live",
      },
      {
        label: "Document editor headers",
        href: "/developer-console/document-editor-headers",
        note: "Three candidate bands for the editor with no rail and no top bar",
      },
      {
        label: "Table states",
        href: "/developer-console/table-states",
        note: "The one table, in every state",
      },
      {
        label: "Address suggestions",
        href: "/developer-console/address-suggestions",
        note: "The street box's offers with Google's name, and saved addresses with Open in Google Maps",
      },
      {
        label: "Upload states",
        href: "/developer-console/upload-states",
        note: "The Upload dialog and the upload tray, mid-transfer and after a failure",
      },
      {
        label: "Loading states",
        href: "/developer-console/loading-states",
        note: "The one loading region, over every shape",
      },
      {
        label: "Document opening stages",
        href: "/developer-console/document-editor-opening",
        note: "The staged wait for the browser editor, each stage running and the two ways it stops",
      },
      {
        label: "Calendar day states",
        href: "/developer-console/calendar-day-states",
        note: "Every month-grid day state, today and selected among them",
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
