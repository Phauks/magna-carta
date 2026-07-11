/*
 * Resolves the matter for every page under /matters/[id].
 *
 * Two sources, in order. A fixture id still resolves from the fixture set — the matters stream has
 * not wired the real list yet, and the demo matters are how the other sections are still read. Any
 * other id is taken to be a REAL matter and resolved through the typed client, which is what lets
 * the Files surface run against the seeded firm: the API rejects a fixture id as malformed, so a
 * real matter can only arrive by its real identifier.
 *
 * The real matter is adapted into the same shape the chrome already reads. Everything the API does
 * not carry — the member/type/location NAMES (it carries ids), the e-billing setting, the timestamps
 * — is null rather than invented: the header and the overview both drop a null, which is honest,
 * where a fabricated `false` would state a setting nobody asked the server for. The section
 * collections are empty because they have their own reads (Files makes its own); a fixture matter
 * keeps its demo rows.
 *
 * An id that is neither a fixture nor a live matter 404s inside the app chrome, the same recovery as
 * any other wrong turn.
 */
import { error } from "@sveltejs/kit";
import { mattersGet } from "@magna-carta/api-client";
import { findMatterFixture, type MatterFixture } from "$lib/matters/fixtures.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = async ({ params, fetch }) => {
  const fixture = findMatterFixture(params.id);
  if (fixture !== undefined) {
    return { matter: fixture };
  }

  const { data } = await mattersGet({ path: { id: params.id }, fetch });
  if (data === undefined) {
    error(404, "Not Found");
  }

  const matter: MatterFixture = {
    id: data.id,
    title: data.title,
    description: data.description,
    status: data.status,
    matterNumber: data.matterNumber,
    matterTypeName: null,
    locationName: null,
    responsibleAttorneyName: null,
    clientDisplayName: data.clientDisplayName,
    clientCode: data.clientCode,
    eBilling: null,
    openedAt: null,
    closedAt: null,
    createdAt: null,
    files: [],
    timeEntries: [],
    costs: [],
  };
  return { matter };
};
