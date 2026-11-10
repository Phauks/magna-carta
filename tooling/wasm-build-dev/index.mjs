// DEV-ONLY, Docker-free build of the WebAssembly artefacts the app consumes — pdf-core into
// packages/pdf/src/pkg, decryption-core into packages/decryption/src/pkg, email-core into
// packages/email/src/pkg, seven-zip-core into packages/seven-zip/src/pkg, segmentation-core into
// packages/segmentation/src/pkg, noise-suppression-core into packages/noise-suppression/src/pkg, and
// pdf-compose-core into packages/pdf-compose/src/pkg —
// using the host Rust toolchain + wasm-pack directly, no container.
//
// This exists for environments that cannot run the canonical Docker build (`rust-wasm-build` in
// vite.config.ts, which builds each crate in the pinned crates/<crate>/wasm.Dockerfile): a cloud
// dev session whose egress policy blocks Docker Hub / ghcr blob pulls, so `FROM rust:1-bookworm`
// cannot be fetched. Native wasm-pack against the host toolchain has no such dependency.
//
// It is NOT authoritative and is refused under CI. The host rustc can differ from the pinned image,
// so the exact wasm bytes may differ; anything shipped (Cloudflare Workers Builds, any release
// artefact) must come from the Docker path. These outputs are git-ignored (packages/*/.gitignore),
// so a Docker-free rebuild is a local dev convenience only, never committed.
//
// Prerequisites it provisions on demand: the wasm32-unknown-unknown target (idempotent) and
// wasm-pack (installed via `cargo install` only when absent). Requires rustup + cargo on PATH.

import { spawnSync } from "node:child_process";

if (process.env.CI) {
  console.error(
    "rust-wasm-build-dev is a dev-only, Docker-free fallback and is refused under CI.\n" +
      "The authoritative wasm build is `vp run rust-wasm-build` (crates/<crate>/wasm.Dockerfile) —\n" +
      "the host toolchain may emit different wasm bytes than the pinned image, so nothing shipped\n" +
      "may come from this path.",
  );
  process.exit(1);
}

// crate directory -> host package directory the crate's wasm-pack output belongs in. The out-dir is
// resolved by wasm-pack relative to the crate's own directory, hence the `../../` climb to the root.
const CRATES = [
  { crate: "pdf-core", pkg: "pdf" },
  { crate: "decryption-core", pkg: "decryption" },
  { crate: "email-core", pkg: "email" },
  { crate: "seven-zip-core", pkg: "seven-zip" },
  { crate: "segmentation-core", pkg: "segmentation" },
  { crate: "noise-suppression-core", pkg: "noise-suppression" },
  { crate: "pdf-compose-core", pkg: "pdf-compose" },
];

function run(command, args) {
  const printable = [command, ...args].join(" ");
  console.log(`\n> ${printable}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to run \`${command}\`: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\`${printable}\` exited with code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

// The wasm compilation target (idempotent — a no-op once installed).
run("rustup", ["target", "add", "wasm32-unknown-unknown"]);

// wasm-pack drives the wasm-bindgen build; install it only when the host does not already carry it.
const hasWasmPack = spawnSync("wasm-pack", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasWasmPack) {
  console.log("wasm-pack not found on PATH — installing with `cargo install wasm-pack --locked`.");
  run("cargo", ["install", "wasm-pack", "--locked"]);
}

for (const { crate, pkg } of CRATES) {
  // --no-opt: wasm-opt is not required; the artefact is semantically correct (matches the Docker
  // output the Dockerfiles produce with the same flag).
  run("wasm-pack", [
    "build",
    `crates/${crate}`,
    "--target",
    "web",
    "--out-dir",
    `../../packages/${pkg}/src/pkg`,
    "--release",
    "--no-opt",
  ]);
}

console.log(`\nDocker-free wasm build complete: ${CRATES.map(({ crate }) => crate).join(", ")}.`);
