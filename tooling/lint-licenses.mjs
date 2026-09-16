// Dependency-license allowlist gate for the NPM supply chain. The platform is proprietary SaaS, so
// AGPL/SSPL — including transitive deps and isolated-service use — are a hard prohibition (AGPL
// treats network interaction as distribution, which would force a source offer). This gate denies by
// default: every dependency's license must be on the permissive allowlist or the build fails. The
// durable rationale lives in the decision log; this file is the mechanism.
//
// THE POLICY ITSELF IS NOT HERE. The allowlist and the SPDX expression classifier live in
// tooling/license-policy/index.mjs, which this gate and the Cargo gate (tooling/license-policy/
// cargo.mjs, `pnpm run lint:cargo-licenses`) both import, so the two supply chains cannot drift into
// two different answers to "is this license allowed". What stays here is what is specific to npm: the
// data source, the reviewed per-package exceptions, and the reporting.
//
// Data source: `pnpm licenses list --json` — no third-party tool or SaaS (the firm keeps dependency
// metadata on its own compute). Run locally with `pnpm run lint:licenses`; CI runs it as a governance
// gate. The shared policy self-tests on startup so a logic regression fails loudly rather than
// silently mis-permitting.
//
// First-party @magna-carta/* workspace packages are not third-party deps and are skipped.
import { execSync } from "node:child_process";
import { classifyLicense, runLicensePolicySelfTest } from "./license-policy/index.mjs";

// Reviewed per-package exceptions: "name@version" => reason. Strict-by-default; an entry here is a
// deliberate, documented call (e.g. a non-SPDX-but-permissive license string). Scoped to npm on
// purpose — a reviewed exception is a statement about one package, not about the policy.
const EXCEPTIONS = new Map([]);

function main() {
  runLicensePolicySelfTest();

  let raw;
  try {
    raw = execSync("pnpm licenses list --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    console.error(
      "license gate: could not run `pnpm licenses list --json` (is the install complete?)",
    );
    console.error(String(error.stderr || error.message || error));
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("license gate: `pnpm licenses list --json` did not return JSON.");
    process.exit(2);
  }

  const offenders = [];
  let scanned = 0;
  // Output shape: { "<license>": [ { name, versions:[...], license, ... }, ... ], ... }
  for (const group of Object.values(data)) {
    for (const pkg of group) {
      // First-party workspace packages are not third-party deps.
      if (pkg.name?.startsWith("@magna-carta/")) continue;
      const versions = pkg.versions?.length ? pkg.versions : ["?"];
      for (const version of versions) {
        scanned += 1;
        const verdict = classifyLicense(pkg.name, version, pkg.license, EXCEPTIONS);
        if (!verdict.allowed) {
          offenders.push(
            `  ${pkg.name}@${version}: ${pkg.license ?? "(none)"} — ${verdict.reason}`,
          );
        }
      }
    }
  }

  if (offenders.length > 0) {
    console.error(`License gate FAILED — ${offenders.length} disallowed dependency license(s):\n`);
    console.error(offenders.join("\n"));
    console.error(
      "\nThe platform is proprietary SaaS: only permissive (and weak-copyleft) licenses are allowed." +
        "\nResolve by removing/replacing the dependency, or — if a license string is a false positive —" +
        "\nadd a reviewed entry to EXCEPTIONS in tooling/lint-licenses.mjs. Changing what the policy" +
        "\npermits is an edit to tooling/license-policy/index.mjs, and changes the Cargo gate too.",
    );
    process.exit(1);
  }

  console.log(`License gate OK — ${scanned} dependency version(s) scanned, all permissive.`);
}

// Run only when invoked directly (allows importing this module without running the gate).
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("lint-licenses.mjs")
) {
  main();
}
