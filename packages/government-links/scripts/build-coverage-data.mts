import { writeFileSync } from "node:fs";
import { allBusinessSites } from "../src/business/registry.ts";
import { allLicensingSites } from "../src/licensing/registry.ts";
import { allAssessorSites } from "../src/property/registry.ts";
import type { AssessorSite } from "../src/types.ts";

// Builds the coverage mockup's data straight from the registry, so the clickable map can never drift
// from the package. One slim record per portal: jurisdiction id, display name, state, system, the
// search URL the map opens on click, and a `deep` flag (a deep-link goes straight to the record from a
// public key; a searchPage only opens the search form — the map's deep-link layer shades on this).
const slim = (site: AssessorSite) => ({
  id: site.jurisdictionId,
  name: site.name,
  state: site.state,
  system: site.system,
  url: site.searchUrl,
  deep: site.deepLink.kind !== "searchPage",
});

// Emit as a JS assignment (not JSON) so the mockup can load it via <script src> — `fetch` is blocked
// for local files opened over file://, but a script tag is not. Returns a one-line summary.
export function writeCoverageData(): string {
  const data = {
    property: allAssessorSites().map(slim),
    business: allBusinessSites().map(slim),
    licensing: allLicensingSites().map(slim),
  };
  writeFileSync(
    new URL("../mockups/coverage-data.js", import.meta.url),
    `window.COVERAGE = ${JSON.stringify(data)};\n`,
  );
  return `property ${data.property.length} · business ${data.business.length} · licensing ${data.licensing.length}`;
}
