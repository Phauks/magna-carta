// Dependency-license allowlist gate for the RUST supply chain — the counterpart of the npm gate in
// tooling/lint-licenses.mjs, applying the same policy from the same module (./index.mjs). The Rust
// tree is vulnerability-scanned in CI but was never license-checked, so an AGPL or SSPL crate could
// land unremarked while the identical npm dependency was rejected at the door. The platform is
// proprietary SaaS: AGPL/SSPL network copyleft would force a source offer, transitively and even
// behind an isolated service, so this denies by default — every resolved crate's license must be on
// the permissive allowlist or the gate fails.
//
// Run: `pnpm run lint:cargo-licenses` (or `node tooling/license-policy/cargo.mjs`). Add --json for the
// machine-readable verdict.
//
// DATA SOURCE: `cargo metadata --format-version 1 --locked --manifest-path <workspace>/Cargo.toml`,
// once per Cargo workspace — no third-party license tool or SaaS, the firm's own compute only. Cargo
// reports each resolved package's `license` (an SPDX expression) and `license_file`, for the FULL
// resolve graph across every target platform and feature, which is the conservative superset a
// license question wants. `--locked` makes a stale Cargo.lock fail here rather than be silently
// updated underneath the scan, so what is judged is what the vulnerability scan and the container
// builds resolve.
//
// COST AND PLACEMENT: `cargo metadata` must have each dependency's own manifest on disk, so on a cold
// machine it first downloads the registry index plus every .crate archive and extracts them. Measured
// over the ten workspaces (866 crate versions): 14.6 s and ~163 MB fetched into a 1.1 GB CARGO_HOME
// on a cold cache, 1.2 s once that cache is warm. The whole cost is the fetch, and it is paid per
// machine, not per run — so this belongs in a CI job that already has the Rust toolchain and a cargo
// cache, and would be an odd thing to put in one that has neither, for a check whose answer changes
// only when a lockfile does.
//
// SCOPE: crates/Cargo.toml plus every containers/*/Cargo.toml — the same first-party lockfiles the
// vulnerability scan audits. The exploration workspaces are deliberately out of scope: nothing in
// them ships, and they are excluded from the vulnerability scan for the same reason. First-party
// crates (workspace members and path dependencies, which Cargo reports with a null `source`) are not
// third-party dependencies and are skipped, the way the npm gate skips @magna-carta/*.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { classifyLicense, runLicensePolicySelfTest } from "./index.mjs";

const execFileAsync = promisify(execFile);

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Reviewed per-crate exceptions: "crate@version" => reason. Strict by default; an entry here is a
// deliberate, documented call, never a way past a finding.
const EXCEPTIONS = new Map([]);

// How many `cargo metadata` invocations run at once. Cargo takes a global package-cache lock while it
// downloads, so a cold run serializes here regardless; the cap keeps a warm run parallel without
// spawning ten cargo processes at once on a one-core runner.
const CONCURRENCY = 4;

// `cargo metadata` emits the whole resolve graph as one JSON document — a few megabytes per
// workspace, well past the default 1 MB pipe buffer.
const MAX_BUFFER = 256 * 1024 * 1024;

// Every Cargo workspace whose dependencies ship: the shared crates workspace, plus one per container.
// Discovered rather than listed, so a new container is covered the day it is added instead of the day
// someone remembers this file.
export function discoverCargoManifests(repositoryRoot) {
  const manifests = [];
  const rootManifest = join(repositoryRoot, "crates", "Cargo.toml");
  if (existsSync(rootManifest)) manifests.push("crates/Cargo.toml");
  const containersDirectory = join(repositoryRoot, "containers");
  if (existsSync(containersDirectory)) {
    for (const entry of readdirSync(containersDirectory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(containersDirectory, entry.name, "Cargo.toml"))) {
        manifests.push(`containers/${entry.name}/Cargo.toml`);
      }
    }
  }
  return manifests;
}

// A package Cargo resolved from a path rather than a registry is first-party: a workspace member, or
// one of this repository's crates pulled in by a relative path from a container workspace. Cargo
// marks those with a null `source`.
export function isFirstPartyPackage(cargoPackage) {
  return cargoPackage.source === null || cargoPackage.source === undefined;
}

// Classify one cargo metadata package. The one case the shared classifier cannot decide on its own is
// a crate that declares no `license` but does carry a `license_file`: the terms are real but live in a
// file nobody has read, so this refuses to guess and names the file for a human to read.
export function classifyCargoPackage(cargoPackage, exceptions = EXCEPTIONS) {
  const { name, version, license, license_file: licenseFile } = cargoPackage;
  if (!license && licenseFile) {
    const key = `${name}@${version}`;
    if (exceptions.has(key)) {
      return { allowed: true, reason: `reviewed exception: ${exceptions.get(key)}` };
    }
    return {
      allowed: false,
      reason:
        `terms are in the crate's own file "${licenseFile}"; read it and either record a reviewed ` +
        "exception or drop the crate — this gate does not guess",
    };
  }
  return classifyLicense(name, version, license, exceptions);
}

// `<crate>@<version>: <license>` plus the reason, one line per finding.
export function formatFinding(cargoPackage, reason) {
  const license = cargoPackage.license ?? "(no license field)";
  return `  ${cargoPackage.name}@${cargoPackage.version}: ${license} — ${reason}`;
}

// Audit a set of cargo metadata documents. Pure over its input so the whole verdict is testable
// without cargo: takes [{ manifest, packages }], returns the counts, the findings and the license
// tally. A crate version resolved by several workspaces is judged once and counted once.
export function auditWorkspaces(documents, exceptions = EXCEPTIONS) {
  const seen = new Set();
  const findings = [];
  const licenseCounts = new Map();
  let firstParty = 0;

  for (const { manifest, packages } of documents) {
    for (const cargoPackage of packages) {
      if (isFirstPartyPackage(cargoPackage)) {
        firstParty += 1;
        continue;
      }
      const key = `${cargoPackage.name}@${cargoPackage.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const license = cargoPackage.license ?? "(no license field)";
      licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
      const verdict = classifyCargoPackage(cargoPackage, exceptions);
      if (!verdict.allowed) {
        findings.push({
          name: cargoPackage.name,
          version: cargoPackage.version,
          license: cargoPackage.license ?? null,
          manifest,
          reason: verdict.reason,
          line: formatFinding(cargoPackage, verdict.reason),
        });
      }
    }
  }

  return { scanned: seen.size, firstParty, findings, licenseCounts };
}

async function readWorkspaceMetadata(manifest) {
  const { stdout } = await execFileAsync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      join(REPOSITORY_ROOT, manifest),
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER },
  );
  return { manifest, packages: JSON.parse(stdout).packages ?? [] };
}

// Run the metadata pass over every workspace, at most CONCURRENCY at a time.
async function readAllWorkspaceMetadata(manifests) {
  const documents = [];
  let next = 0;
  const worker = async () => {
    while (next < manifests.length) {
      const manifest = manifests[next];
      next += 1;
      documents.push(await readWorkspaceMetadata(manifest));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, manifests.length) }, worker));
  return documents;
}

async function main() {
  runLicensePolicySelfTest();

  const asJson = process.argv.includes("--json");
  const manifests = discoverCargoManifests(REPOSITORY_ROOT);
  if (manifests.length === 0) {
    console.error("cargo license gate: found no Cargo workspaces to scan — refusing to pass.");
    process.exit(2);
  }

  const startedAt = Date.now();
  let documents;
  try {
    documents = await readAllWorkspaceMetadata(manifests);
  } catch (error) {
    console.error(
      "cargo license gate: `cargo metadata` failed. It needs the cargo toolchain and, on a cold" +
        " machine, network access to fetch the registry index and each crate's manifest.",
    );
    console.error(String(error.stderr || error.message || error));
    process.exit(2);
  }
  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  const { scanned, findings, licenseCounts } = auditWorkspaces(documents);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          workspaces: manifests,
          scanned,
          elapsedSeconds: Number(elapsedSeconds),
          licenses: Object.fromEntries([...licenseCounts].sort((a, b) => b[1] - a[1])),
          findings: findings.map(({ name, version, license, manifest, reason }) => ({
            name,
            version,
            license,
            manifest,
            reason,
          })),
        },
        null,
        2,
      ),
    );
  }

  if (findings.length > 0) {
    if (!asJson) {
      console.error(
        `Cargo license gate FAILED — ${findings.length} disallowed crate license(s):\n`,
      );
      console.error(findings.map((finding) => `${finding.line}  [${finding.manifest}]`).join("\n"));
      console.error(
        "\nThe platform is proprietary SaaS: only permissive (and weak-copyleft) licenses are allowed." +
          "\nResolve by removing/replacing the crate, or — if a license string is a false positive —" +
          "\nadd a reviewed entry to EXCEPTIONS in tooling/license-policy/cargo.mjs. Changing what the" +
          "\npolicy permits is an edit to tooling/license-policy/index.mjs, and changes both gates.",
      );
    }
    process.exit(1);
  }

  if (!asJson) {
    console.log(
      `Cargo license gate OK — ${scanned} crate version(s) across ${manifests.length} workspace(s), all permissive (${elapsedSeconds}s).`,
    );
  }
}

// Run only when invoked directly, so the audit functions can be imported by the tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cargo.mjs")) {
  await main();
}
