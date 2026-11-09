/*
 * The customer changelog, as the Changelog screen reads it.
 *
 * GENERATED, NEVER WRITTEN HERE. The words come from docs/public-changelog.md, which `vp run
 * changelog-build` assembles on `main` from the `## Public` blocks of `audience: public` fragments
 * in changelog.d/ — so a change that ships with a public fragment appears on this screen in the
 * same build, and nobody keeps a second list. The document is pulled in as text when the bundle is
 * built and turned into the published artifact by the strict parser in @magna-carta/product-updates,
 * the same one its corpus test holds the document to.
 *
 * VERSION-ACCURATE BY CONSTRUCTION. Because the document travels inside the build, the screen can
 * only ever describe the build it is part of: it cannot announce a change the running application
 * does not have, and it needs no network to render.
 *
 * Only the Changelog screen imports this module, and SvelteKit splits each screen into its own
 * chunk, so the document's text is fetched when somebody opens the screen rather than with the
 * shell.
 */
import {
  buildPublicChangelogArtifact,
  groupIntoReleases,
  type PublicChangelogRelease,
} from "@magna-carta/product-updates";
import { BUILD_IDENTITY } from "$lib/build-identity.ts";
import changelogDocument from "../../../../../docs/public-changelog.md?raw";

/** Every dated release in the document, newest first, entries grouped by category. */
export function publicChangelogReleases(): PublicChangelogRelease[] {
  return groupIntoReleases(buildPublicChangelogArtifact(changelogDocument, BUILD_IDENTITY.builtAt));
}
