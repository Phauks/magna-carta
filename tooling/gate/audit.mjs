// The dependency audit: osv-scanner over BOTH supply chains — the pnpm lockfile and every first-party
// Cargo.lock — against the OSV database, failing on any remaining HIGH or CRITICAL finding. The
// accepted-advisory register is osv-scanner.toml at the repository root (one home; each entry carries
// its cause and, where time-boxed, its expiry).
//
// THE BINARY IS PINNED BY VERSION AND HASH. The release asset for this machine's platform is
// downloaded once into node_modules/.cache and verified against the SHA256 published in that
// release's osv-scanner_SHA256SUMS before it is made executable — a swapped or tampered asset fails
// closed. Update the version and every hash together, from the new release's SHA256SUMS file. A copy
// already on PATH is used as it is (a developer who installs their own keeps it).
//
// The scanner's exit code carries meaning and every meaningful code is checked explicitly:
//   0     no advisories in any audited lockfile — pass;
//   1     advisories present after the ignores — classify by severity below;
//   >=127 a scan or configuration error (128 = no packages found) — a broken scan never passes.
//
// The classification is a pure function over the JSON report (highOrCriticalOffenders) so it is
// tested from constructed reports rather than read off a live scan.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

export const OSV_SCANNER_VERSION = "2.4.0";

/** SHA256 of each release asset, from osv-scanner_SHA256SUMS of the release above. */
export const OSV_SCANNER_ASSETS = new Map([
  [
    "linux-x64",
    ["osv-scanner_linux_amd64", "15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0"],
  ],
  [
    "linux-arm64",
    ["osv-scanner_linux_arm64", "44e580752910f0ff36ec99aff59af20f65df1e859aa31e5605a8f0d055b496e9"],
  ],
  [
    "darwin-x64",
    [
      "osv-scanner_darwin_amd64",
      "088119325156321c34c456ac3703d6013538fd71cbac82b891ab34db491e4d66",
    ],
  ],
  [
    "darwin-arm64",
    [
      "osv-scanner_darwin_arm64",
      "9ca3185ad63e9ab54f7cb90f46a7362be02d80e37f0123d095a54355ea202f5d",
    ],
  ],
  [
    "win32-x64",
    [
      "osv-scanner_windows_amd64.exe",
      "0cdd113610126d5dfd5e12ad0e0b4f3e879291ff19bb43b0c52ed2f2c2df1a37",
    ],
  ],
  [
    "win32-arm64",
    [
      "osv-scanner_windows_arm64.exe",
      "1ce89d7d8ef083634648ef0f193fe1254f36f46f4bdc93d61178adacc2e60da0",
    ],
  ],
]);

/** The release asset for a platform, or null when no pinned binary exists for it. */
export function assetFor(platform, arch) {
  return OSV_SCANNER_ASSETS.get(`${platform}-${arch}`) ?? null;
}

/**
 * The lockfiles the audit covers: the workspace's, the crates workspace's, and one per container
 * Cargo workspace — derived from disk rather than listed, so a new container's lockfile is audited
 * from the day it exists.
 */
export function auditedLockfiles(root) {
  const candidates = ["pnpm-lock.yaml", "crates/Cargo.lock"];
  const containers = path.join(root, "containers");
  if (existsSync(containers)) {
    for (const entry of readdirNames(containers)) {
      candidates.push(`containers/${entry}/Cargo.lock`);
    }
  }
  return candidates.filter((relative) => existsSync(path.join(root, relative)));
}

/** The container directory names, sorted so the invocation (and the report) is stable run to run. */
function readdirNames(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * osv-scanner groups findings per package. Prefer the group's `max_severity` (the max CVSS base
 * score across the group); when it is empty (an advisory carrying no CVSS vector) fall back to the
 * member advisories' `database_specific.severity` text. HIGH is CVSS >= 7.0, or a HIGH|CRITICAL
 * label. Mirrors what the scanner's own `--fail-on` would do, made explicit so the rule is readable.
 *
 * @returns {{ package: string, ecosystem: string, ids: string[], maxSeverity: string, classifiedBy: string }[]}
 */
export function highOrCriticalOffenders(report) {
  const offenders = [];
  const seen = new Set();
  for (const result of report.results ?? []) {
    for (const entry of result.packages ?? []) {
      for (const group of entry.groups ?? []) {
        const ids = group.ids ?? [];
        const members = (entry.vulnerabilities ?? []).filter((v) => ids.includes(v.id));
        const raw = group.max_severity ?? "";
        const score = raw === "" ? null : Number(raw);
        const hasScore = score !== null && Number.isFinite(score);
        const byScore = hasScore && score >= 7.0;
        const byText = members.some((member) =>
          ["HIGH", "CRITICAL"].includes(
            String(member.database_specific?.severity ?? "").toUpperCase(),
          ),
        );
        if (!(byScore || (!hasScore && byText))) continue;
        const offender = {
          package: entry.package?.name ?? "?",
          ecosystem: entry.package?.ecosystem ?? "?",
          ids,
          maxSeverity: raw,
          classifiedBy: byScore ? "cvss>=7.0" : "severity-text",
        };
        const key = JSON.stringify(offender);
        if (seen.has(key)) continue;
        seen.add(key);
        offenders.push(offender);
      }
    }
  }
  return offenders;
}

export function describeOffender(offender) {
  return (
    `  [${offender.ecosystem}] ${offender.package}: ${offender.ids.join(", ")} ` +
    `(max_severity=${offender.maxSeverity}, ${offender.classifiedBy})`
  );
}

function sha256Of(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function onPath(name) {
  const probe = spawnSync(name, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Locate, or fetch and verify, the pinned scanner. Returns `{ command }` to run, or
 * `{ unavailable: <reason> }` when no binary can be had — no pinned asset for this platform, no curl
 * to fetch with, or the download failed (typically: offline). The caller decides what an
 * unavailable scanner means for the gate; this never guesses.
 */
export function resolveScanner({ root, platform = process.platform, arch = process.arch, log }) {
  if (onPath("osv-scanner")) return { command: "osv-scanner", source: "PATH" };

  const asset = assetFor(platform, arch);
  if (asset === null) {
    return {
      unavailable: `no pinned osv-scanner ${OSV_SCANNER_VERSION} asset for ${platform}-${arch}; install osv-scanner on PATH`,
    };
  }
  const [assetName, expectedHash] = asset;
  const cacheDirectory = path.join(
    root,
    "node_modules",
    ".cache",
    "magna-carta",
    "osv-scanner",
    OSV_SCANNER_VERSION,
  );
  const binary = path.join(
    cacheDirectory,
    platform === "win32" ? "osv-scanner.exe" : "osv-scanner",
  );
  if (existsSync(binary) && sha256Of(binary) === expectedHash) {
    return { command: binary, source: "cache" };
  }

  if (!onPath("curl")) {
    return { unavailable: "curl is not on PATH, so the pinned osv-scanner cannot be fetched" };
  }
  mkdirSync(cacheDirectory, { recursive: true });
  const partial = `${binary}.download`;
  const url = `https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${assetName}`;
  log?.(`fetching osv-scanner ${OSV_SCANNER_VERSION} (${assetName})`);
  const fetched = spawnSync(
    "curl",
    ["-fsSL", "--retry", "2", "--max-time", "120", "-o", partial, url],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", shell: process.platform === "win32" },
  );
  if (fetched.status !== 0) {
    rmSync(partial, { force: true });
    return {
      unavailable: `could not download ${url} (${(fetched.stderr ?? "").trim() || `curl exit ${fetched.status}`})`,
    };
  }
  const actual = sha256Of(partial);
  if (actual !== expectedHash) {
    rmSync(partial, { force: true });
    // A hash mismatch is not "unavailable": it is the one case that must fail the gate outright, so
    // it is thrown rather than returned.
    throw new Error(
      `osv-scanner download failed SHA256 verification (expected ${expectedHash}, got ${actual}) — refusing to run it`,
    );
  }
  renameSync(partial, binary);
  if (platform !== "win32") chmodSync(binary, 0o755);
  return { command: binary, source: "downloaded" };
}

/**
 * Run the audit. Returns `{ status: "passed" | "failed" | "not-run", detail }`. Writes the JSON report
 * to a file rather than capturing stdout: the report is large and a stray non-JSON line on stdout
 * would corrupt the capture.
 */
export function runAudit({ root, reportPath, log = () => {} }) {
  let scanner;
  try {
    scanner = resolveScanner({ root, log });
  } catch (error) {
    return { status: "failed", detail: error.message };
  }
  if (scanner.unavailable !== undefined) {
    return { status: "not-run", detail: scanner.unavailable };
  }
  log(`osv-scanner from ${scanner.source}`);

  const lockfiles = auditedLockfiles(root);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  rmSync(reportPath, { force: true });
  const scan = spawnSync(
    scanner.command,
    [
      "scan",
      "source",
      "--config",
      "osv-scanner.toml",
      "--format",
      "json",
      "--output-file",
      reportPath,
      ...lockfiles.flatMap((lockfile) => ["-L", lockfile]),
    ],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" },
  );
  const code = scan.status;
  log(`osv-scanner exit code: ${code} over ${lockfiles.length} lockfile(s)`);
  if (code === 0) return { status: "passed", detail: "no advisories in any audited lockfile" };
  if (code !== 1) {
    return {
      status: "failed",
      detail: `osv-scanner exit ${code} (a scan or configuration error; 128 = no packages found) — a broken scan never passes`,
    };
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    return { status: "failed", detail: `could not read the JSON report: ${error.message}` };
  }
  const offenders = highOrCriticalOffenders(report);
  if (offenders.length === 0) {
    return {
      status: "passed",
      detail: "advisories present but none HIGH or CRITICAL after the accepted-advisory register",
    };
  }
  return {
    status: "failed",
    detail:
      `${offenders.length} HIGH/CRITICAL advisor${offenders.length === 1 ? "y" : "ies"} remain after osv-scanner.toml:\n` +
      offenders.map(describeOffender).join("\n"),
  };
}
