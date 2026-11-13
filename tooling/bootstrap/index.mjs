// Make a freshly-created worktree runnable: ensure the generated Rust->WASM artefacts the TypeScript
// packages import actually exist, and point cargo at a cache shared by every worktree on the machine.
//
// packages/{pdf,decryption,email}/src/pkg/ is generated (wasm-bindgen output) and git-ignored, so a new
// worktree starts without it and every `vitest`/`tsc` run against those packages fails on a missing
// import until someone rebuilds it. This makes that a single idempotent command instead of a thing each
// contributor rediscovers: it rebuilds only what is stale, and is a no-op (sub-second) when everything
// is current, so it is safe to run at the top of any session.
//
// "Rebuilds only what is stale" is answered by CONTENT, not by mtimes: each output carries a stamp
// holding the hash of the Rust sources it was built from, and a build is only believed once the emitted
// bindings are checked to export everything the crate declares (artefact-verification.mjs explains why
// both are needed — every worktree shares one cargo cache, and a cache hit re-emits bindings from a
// compilation of sources that are not the ones on disk here).
//
// The canonical build for the deploy pipeline stays `vp run rust-wasm-build` (Docker, pinned toolchain,
// no host Rust) — that is what Cloudflare Workers Builds runs. This is the local fast path: the same
// wasm-pack invocation on the host toolchain, which is minutes faster than a Docker build and is all a
// local test/type-check needs. Use --docker to force the pinned-image build instead.
//
// Usage: vp run bootstrap [--check] [--force] [--docker]
//   --check   report staleness and exit non-zero if anything needs building; build nothing
//   --force   rebuild every artefact regardless of staleness
//   --docker  build via the pinned Docker images (the canonical path) rather than host wasm-pack

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  crateWasmExports,
  hashSourceTree,
  isFile,
  missingBindings,
  readStamp,
} from "./artefact-verification.mjs";
import { callerDirectory, refusalReason } from "./invocation-environment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Before anything else: is this the checkout the caller meant, and are its dependencies installed?
// Both can be false while every command still exits 0 — invocation-environment.mjs explains how — and a
// bootstrap that silently succeeds against the wrong tree is worse than one that never ran, because the
// next failure surfaces somewhere else entirely.
const refusal = refusalReason({ scriptRoot: ROOT, invokedFrom: callerDirectory() });
if (refusal !== null) {
  console.error(refusal);
  process.exit(1);
}

/** The generated-artefact graph: one wasm-bindgen output per crate, consumed by one TypeScript package. */
const ARTEFACTS = [
  { crate: "pdf-core", pkg: "packages/pdf", wasm: "pdf_core_bg.wasm", bindings: "pdf_core.js" },
  {
    crate: "decryption-core",
    pkg: "packages/decryption",
    wasm: "decryption_core_bg.wasm",
    bindings: "decryption_core.js",
  },
  {
    crate: "email-core",
    pkg: "packages/email",
    wasm: "email_core_bg.wasm",
    bindings: "email_core.js",
  },
  {
    crate: "seven-zip-core",
    pkg: "packages/seven-zip",
    wasm: "seven_zip_core_bg.wasm",
    bindings: "seven_zip_core.js",
  },
  {
    crate: "segmentation-core",
    pkg: "packages/segmentation",
    wasm: "segmentation_core_bg.wasm",
    bindings: "segmentation_core.js",
  },
  {
    crate: "noise-suppression-core",
    pkg: "packages/noise-suppression",
    wasm: "noise_suppression_core_bg.wasm",
    bindings: "noise_suppression_core.js",
  },
  {
    crate: "mls-core",
    pkg: "packages/mls",
    wasm: "mls_core_bg.wasm",
    bindings: "mls_core.js",
  },
  {
    crate: "disarm-core",
    pkg: "packages/disarm",
    wasm: "disarm_core_bg.wasm",
    bindings: "disarm_core.js",
  },
  {
    crate: "pdf-compose-core",
    pkg: "packages/pdf-compose",
    wasm: "pdf_compose_core_bg.wasm",
    bindings: "pdf_compose_core.js",
  },
];

// The stamp lives beside the generated output (inside the git-ignored pkg directory), so it is created
// and destroyed with the artefact it describes and can never outlive it.
const STAMP = ".source-stamp.json";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const force = args.has("--force");
const useDocker = args.has("--docker");

/** Where a built artefact's files live. */
const outputDirectory = ({ pkg }) => path.join(ROOT, pkg, "src", "pkg");

// The workspace-local crates a crate compiles together with: itself, plus every `path = "../x"`
// dependency, transitively. Changing engine-host changes what email-core emits, so its sources belong
// in email-core's input hash; ocr-core's do not.
function inputCrates(crate, seen = new Set()) {
  if (seen.has(crate)) return seen;
  seen.add(crate);
  const manifest = path.join(ROOT, "crates", crate, "Cargo.toml");
  if (!existsSync(manifest)) return seen;
  for (const match of readFileSync(manifest, "utf8").matchAll(/path\s*=\s*"\.\.\/([^"]+)"/g)) {
    inputCrates(match[1], seen);
  }
  return seen;
}

// The digest of everything that can change what this crate emits: its own sources, its workspace-local
// dependencies' sources, and the workspace manifests that pin every version.
function sourceHash(crate) {
  const digest = createHash("sha256");
  // Sorted so the digest does not depend on the order the manifests were walked in.
  const ordered = [...inputCrates(crate)].toSorted((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const input of ordered) {
    digest.update(`${input}:${hashSourceTree(path.join(ROOT, "crates", input))}\n`);
  }
  for (const manifest of ["Cargo.toml", "Cargo.lock"]) {
    const file = path.join(ROOT, "crates", manifest);
    digest.update(`${manifest}:`);
    if (existsSync(file)) digest.update(readFileSync(file));
    digest.update("\n");
  }
  return digest.digest("hex");
}

// The declared export names the emitted bindings do not carry. An artefact re-emitted from a cached
// compilation of older sources fails here — the one check that looks at what was actually written to
// disk rather than at when it was written.
function absentBindings(artefact) {
  const bindings = path.join(outputDirectory(artefact), artefact.bindings);
  if (!isFile(bindings)) return [artefact.bindings]; // no module at all — every export is absent
  return missingBindings(
    crateWasmExports(path.join(ROOT, "crates", artefact.crate)),
    readFileSync(bindings, "utf8"),
  );
}

/**
 * Why an artefact needs building, or null when it is trustworthy. Staleness is a CONTENT question, not
 * an mtime one: the stamp records the hash of the sources the artefact was built from, and the emitted
 * bindings must still carry every export the crate declares.
 */
function isStale(artefact) {
  const built = path.join(outputDirectory(artefact), artefact.wasm);
  if (!isFile(built) || !isFile(path.join(outputDirectory(artefact), artefact.bindings))) {
    return "missing";
  }
  const stamp = readStamp(path.join(outputDirectory(artefact), STAMP));
  if (stamp === null) return "unstamped";
  if (stamp.sourceHash !== sourceHash(artefact.crate)) return "stale";
  const absent = absentBindings(artefact);
  return absent.length > 0 ? `incomplete (no ${absent.join(", ")})` : null;
}

// Cargo's target/ is per-worktree by default, so N worktrees each keep a cold, independent Rust cache
// and every one of them pays a full dependency compile. Pointing them all at one absolute target dir
// makes the second worktree's build a cache hit. The path is machine-local, so it is written to a
// git-ignored crates/.cargo/config.toml rather than committed. Concurrent cargo builds across worktrees
// serialize on cargo's own lock ("Blocking waiting for file lock") — which is also the behaviour we
// want on a 16 GB box (see the OOM mitigations: never run heavy builds across worktrees at once).
// Set MAGNA_CARTA_SHARED_CARGO_TARGET=0 to opt out and keep a per-worktree target/.
function configureSharedCargoTarget() {
  if (process.env.MAGNA_CARTA_SHARED_CARGO_TARGET === "0") return null;
  const shared =
    process.env.CARGO_TARGET_DIR ?? path.join(homedir(), ".cache", "magna-carta", "cargo-target");
  mkdirSync(shared, { recursive: true });
  const configDir = path.join(ROOT, "crates", ".cargo");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, "config.toml"),
    `# GENERATED by \`vp run bootstrap\` — machine-local, git-ignored, never committed.\n` +
      `# One cargo cache shared by every worktree on this machine, so a new worktree does not pay a cold\n` +
      `# dependency compile. Opt out with MAGNA_CARTA_SHARED_CARGO_TARGET=0, then delete this file.\n` +
      `[build]\ntarget-dir = ${JSON.stringify(shared)}\n`,
  );
  return shared;
}

function have(command) {
  const probe = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}

function buildHost({ crate, pkg }) {
  execFileSync(
    "wasm-pack",
    [
      "build",
      `crates/${crate}`,
      "--target",
      "web",
      "--out-dir",
      `../../${pkg}/src/pkg`,
      "--release",
      "--no-opt",
    ],
    { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
}

function buildDocker({ crate, pkg }, { fresh = false } = {}) {
  execFileSync(
    "docker",
    [
      "build",
      "--network=host",
      ...(fresh ? ["--no-cache"] : []),
      "--output",
      `type=local,dest=${pkg}/src/pkg`,
      "-f",
      `crates/${crate}/wasm.Dockerfile`,
      "crates",
    ],
    { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
}

// Drop this crate's compiled artefacts from the shared cargo cache so the next build genuinely
// recompiles it. Reached only when the emitted bindings came out incomplete, which means cargo
// considered a cached compilation current for sources that are not the ones on disk — the exact
// condition a fingerprint cannot be argued out of, only discarded.
function discardCargoCache(crate) {
  spawnSync("cargo", ["clean", "-p", crate], {
    cwd: path.join(ROOT, "crates"),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function build(artefact, { fresh = false } = {}) {
  if (useDocker) buildDocker(artefact, { fresh });
  else buildHost(artefact);
}

const shared = configureSharedCargoTarget();
if (shared) console.log(`bootstrap: cargo target-dir -> ${shared} (shared across worktrees)`);

const work = ARTEFACTS.map((a) => ({ ...a, reason: force ? "forced" : isStale(a) })).filter(
  (a) => a.reason,
);

if (work.length === 0) {
  console.log(`bootstrap: ${ARTEFACTS.length} wasm artefacts present and current — nothing to do`);
  process.exit(0);
}

if (checkOnly) {
  for (const a of work)
    console.error(`bootstrap: ${a.pkg}/src/pkg is ${a.reason} (crates/${a.crate})`);
  console.error("bootstrap: run `vp run bootstrap` to build them");
  process.exit(1);
}

if (!useDocker && !have("wasm-pack")) {
  console.error(
    "bootstrap: wasm-pack not found on PATH. Install it (cargo install wasm-pack) for the fast local\n" +
      "path, or run `vp run bootstrap --docker` to build with the pinned images (needs Docker).",
  );
  process.exit(1);
}

for (const a of work) {
  const started = Date.now();
  console.log(`bootstrap: building ${a.pkg}/src/pkg (${a.reason}) from crates/${a.crate}...`);
  // Hash the inputs BEFORE the build: an edit made while the build runs must not be stamped as built.
  const builtFrom = sourceHash(a.crate);
  build(a);

  // Verify what landed on disk, not that the build command exited 0. A build satisfied from the shared
  // cargo cache re-emits bindings from a cached compilation and still exits 0, so success is defined
  // as "the emitted module exports everything the crate declares".
  let absent = absentBindings(a);
  if (absent.length > 0) {
    console.warn(
      `bootstrap: ${a.pkg}/src/pkg came out without ${absent.join(", ")} — the build reused a cached\n` +
        `compilation of different sources. Discarding it and rebuilding ${a.crate} from scratch.`,
    );
    if (!useDocker) discardCargoCache(a.crate);
    build(a, { fresh: true });
    absent = absentBindings(a);
  }
  if (absent.length > 0) {
    console.error(
      `bootstrap: ${a.pkg}/src/pkg still does not export ${absent.join(", ")} after a clean rebuild.\n` +
        `Importing it would fail at runtime ("is not a function"), so this is a failure, not a warning.\n` +
        `Check crates/${a.crate} for a wasm-bindgen export that no longer compiles for wasm32.`,
    );
    process.exit(1);
  }

  // Only a verified artefact gets stamped, so a failed or interrupted build can never make the next
  // run believe the output is current.
  writeFileSync(
    path.join(outputDirectory(a), STAMP),
    `${JSON.stringify({ crate: a.crate, sourceHash: builtFrom, exports: crateWasmExports(path.join(ROOT, "crates", a.crate)) }, null, 2)}\n`,
  );
  console.log(`bootstrap: built ${a.crate} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
console.log(`bootstrap: ${work.length} artefact(s) built and verified — worktree ready`);
