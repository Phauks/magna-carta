// Dependency-license allowlist gate. The platform is proprietary SaaS, so AGPL/SSPL —
// including transitive deps and isolated-service use — are a hard prohibition (AGPL
// treats network interaction as distribution, which would force a source offer). This
// gate denies-by-default: every dependency's license must be on the permissive allowlist
// or the build fails. The durable rationale lives in the decision log; this file is the
// mechanism.
//
// Data source: `pnpm licenses list --json` — no third-party tool or SaaS (the firm keeps
// dependency metadata on its own compute). Run locally with `pnpm run lint:licenses`; CI
// runs it as a governance gate. The classifier self-tests on startup so a logic regression
// fails loudly rather than silently mis-permitting.
//
// SPDX expressions read AS-USED: "(MIT OR GPL-2.0)" passes (a permissive disjunct exists);
// "(A AND B)" requires every operand permissive. Unknown/UNLICENSED fails (must be reviewed).
// First-party @magna-carta/* workspace packages are not third-party deps and are skipped.
import { execSync } from "node:child_process";

// Allowed SPDX identifiers: permissive licenses plus WEAK copyleft (MPL-2.0 file-level,
// LGPL library-level) — weak copyleft is SaaS-compatible (use in proprietary software is
// permitted) and is materially different from the AGPL/SSPL network copyleft this gate
// exists to deny. Keep this list tight; adding one is a deliberate policy act.
const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Zlib",
  "Python-2.0",
  // SIL Open Font License 1.1 — the permissive open-font license the bundled UI webfonts declare
  // (@fontsource-variable/atkinson-hyperlegible-next, @fontsource-variable/fraunces,
  // @fontsource/unifrakturmaguntia). OFL explicitly permits embedding + redistribution inside
  // software; its only restriction is selling the font files on their own, which does not affect
  // bundling a webfont into the app. A font license, not a general-purpose code license — but the
  // gate classifies by SPDX id and OFL-only packages here are all fonts.
  "OFL-1.1",
]);

// Non-SPDX license strings some older packages emit, mapped to their SPDX equivalent.
const ALIASES = new Map([
  ["BSD", "BSD-3-Clause"],
  ["MIT*", "MIT"],
  ["Apache 2.0", "Apache-2.0"],
  ["Apache License 2.0", "Apache-2.0"],
  ["Apache2", "Apache-2.0"],
]);

// Reviewed per-package exceptions: "name@version" => reason. Strict-by-default; an entry
// here is a deliberate, documented call (e.g. a non-SPDX-but-permissive license string).
const EXCEPTIONS = new Map([]);

function normalizeAtom(license) {
  const trimmed = license.trim();
  return ALIASES.get(trimmed) ?? trimmed;
}

function atomPermissive(license) {
  return ALLOWED.has(normalizeAtom(license));
}

// Evaluate an SPDX license expression as-used. Operators are matched case-sensitively and
// whitespace-delimited (SPDX `OR`/`AND` are uppercase) so they don't catch the lowercase
// "or"/"and" inside identifiers like "LGPL-3.0-or-later". OR is checked first (lowest
// precedence), so "A OR B AND C" reads as "A OR (B AND C)".
function expressionPermissive(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  if (/\sOR\s/.test(clean)) {
    return clean.split(/\sOR\s/).some((operand) => expressionPermissive(operand));
  }
  if (/\sAND\s/.test(clean)) {
    return clean.split(/\sAND\s/).every((operand) => expressionPermissive(operand));
  }
  return atomPermissive(clean);
}

// Pure classifier. Exported shape: { allowed: boolean, reason: string }.
export function classifyLicense(name, version, license) {
  if (EXCEPTIONS.has(`${name}@${version}`)) {
    return { allowed: true, reason: `reviewed exception: ${EXCEPTIONS.get(`${name}@${version}`)}` };
  }
  if (!license || license === "UNLICENSED" || /^unknown$/i.test(license)) {
    return {
      allowed: false,
      reason: `no resolvable license (${license ?? "missing"}) — review required`,
    };
  }
  const ok = expressionPermissive(license);
  return ok
    ? { allowed: true, reason: license }
    : { allowed: false, reason: `not on the permissive allowlist: ${license}` };
}

// Self-test the classifier so a regression fails the gate rather than mis-permitting silently.
function selfTest() {
  const expect = (cond, label) => {
    if (!cond) throw new Error(`license-classifier self-test failed: ${label}`);
  };
  expect(classifyLicense("p", "1", "MIT").allowed, "MIT allowed");
  expect(classifyLicense("p", "1", "Apache-2.0").allowed, "Apache-2.0 allowed");
  expect(!classifyLicense("p", "1", "AGPL-3.0").allowed, "AGPL denied");
  expect(!classifyLicense("p", "1", "SSPL-1.0").allowed, "SSPL denied");
  expect(
    classifyLicense("p", "1", "(MIT OR GPL-2.0)").allowed,
    "OR with permissive disjunct allowed",
  );
  expect(classifyLicense("p", "1", "(Apache-2.0 AND MIT)").allowed, "AND all-permissive allowed");
  expect(
    classifyLicense("p", "1", "Apache-2.0 AND LGPL-3.0-or-later").allowed,
    "weak-copyleft LGPL allowed (sharp/libvips)",
  );
  expect(
    !classifyLicense("p", "1", "(MIT AND GPL-3.0)").allowed,
    "AND with strong copyleft denied",
  );
  expect(!classifyLicense("p", "1", "UNLICENSED").allowed, "UNLICENSED denied");
  expect(!classifyLicense("p", "1", "Frobnicate-1.0").allowed, "unknown license denied");
  expect(classifyLicense("p", "1", "BSD").allowed, "BSD alias allowed");
  expect(classifyLicense("p", "1", "OFL-1.1").allowed, "OFL-1.1 font license allowed");
  expect(
    !classifyLicense("p", "1", "Limited W3 License").allowed,
    "apca-w3's field-restricted 'Limited W3 License' stays denied (not the permissive W3C license)",
  );
}

function main() {
  selfTest();

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
        const verdict = classifyLicense(pkg.name, version, pkg.license);
        if (!verdict.allowed) {
          offenders.push(`  ${pkg.name}@${version} — ${verdict.reason}`);
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
        "\nadd a reviewed entry to EXCEPTIONS in tooling/lint-licenses.mjs.",
    );
    process.exit(1);
  }

  console.log(`License gate OK — ${scanned} dependency version(s) scanned, all permissive.`);
}

// Run only when invoked directly (allows importing the classifier for reuse/tests).
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("lint-licenses.mjs")
) {
  main();
}
