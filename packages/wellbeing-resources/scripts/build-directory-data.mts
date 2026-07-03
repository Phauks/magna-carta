import { writeFileSync } from "node:fs";
import { coverageManifest } from "../src/manifest.ts";
import { allCoveredJurisdictions, nationalResources } from "../src/registry.ts";

// Builds the coverage mockup's data straight from the registry, so the clickable directory can never
// drift from the package. Emitted as a JS assignment (not JSON) so the mockup loads it via <script src>
// — fetch is blocked for file:// pages, a script tag is not.
function main(): void {
  const data = {
    manifest: coverageManifest(),
    national: nationalResources().map((r) => ({ name: r.name, url: r.url ?? "" })),
    jurisdictions: allCoveredJurisdictions().map((j) => ({
      code: j.code,
      name: j.name,
      count: j.resources.length,
      fallbackOnly: j.nationalFallbackOnly,
    })),
  };
  writeFileSync(
    new URL("../mockups/directory-data.js", import.meta.url),
    `window.WELLBEING = ${JSON.stringify(data)};\n`,
  );
  console.log(
    `wrote mockups/directory-data.js: ${data.jurisdictions.length} jurisdictions, ${data.national.length} national`,
  );
}

main();
