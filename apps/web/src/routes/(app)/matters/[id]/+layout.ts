/*
 * Resolves the matter for every page under /matters/[id] from the fixture set — the screen is
 * presentation-only until the matters list stream wires the real API. An unknown id 404s inside
 * the app chrome (the group's +error.svelte), the same recovery as any other wrong turn.
 */
import { error } from "@sveltejs/kit";
import { findMatterFixture } from "$lib/matters/fixtures.ts";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = ({ params }) => {
  const matter = findMatterFixture(params.id);
  if (matter === undefined) {
    error(404, "Not Found");
  }
  return { matter };
};
