// What a change set can reach, and therefore which dimensions of the gate have an input.
//
// Documentation and the rendered trackers (`docs/**`, `changelog.d/**`, `status.d/**`,
// `roadmap.d/**`, every `*.md`, and `STATUS.json`) are non-code: nothing in the repository reads any
// of them at build or test time, so a docs-only change runs only the dimensions that read prose —
// format and governance. `STATUS.json` is named specifically because it is not markdown, and a
// markdown-only exclusion once classified the per-merge docs-assembly commit as a code change and
// booted the whole battery for it. One exception is put straight back: a file with a source extension
// is a real input wherever it lives, so a script landing under one of those trees still counts.
//
// Pure functions over path lists, so the decisions are tested from constructed inputs
// (classify.test.mjs) rather than read off a live diff.

const NON_CODE = /\.md$|^STATUS\.json$|^(docs|changelog\.d|status\.d|roadmap\.d)\//;
const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts|js|mjs|cjs|svelte|rs)$/;

// crates/ holds every manifest, source file and wasm.Dockerfile the Rust dimension covers (the
// container Cargo workspaces are the containers dimension's concern); a toolchain bump re-verifies the
// crates workspace too.
const RUST_INPUT = /^crates\/|^rust-toolchain\.toml$/;
const CONTAINER_INPUT = /^containers\//;

/**
 * @param {readonly string[]} changedFiles repo-relative forward-slash paths.
 * @returns {{ codeFiles: string[], code: boolean, rust: boolean, containers: boolean }}
 */
export function classify(changedFiles) {
  const codeFiles = changedFiles.filter(
    (file) => !NON_CODE.test(file) || SOURCE_EXTENSION.test(file),
  );
  return {
    codeFiles,
    code: codeFiles.length > 0,
    rust: codeFiles.some((file) => RUST_INPUT.test(file)),
    containers: codeFiles.some((file) => CONTAINER_INPUT.test(file)),
  };
}

/** The container directories (`containers/<name>`) a change set touches, sorted. */
export function changedContainers(changedFiles) {
  const names = new Set();
  for (const file of changedFiles) {
    const match = /^containers\/([^/]+)\//.exec(file);
    if (match !== null) names.add(match[1]);
  }
  return [...names].toSorted((a, b) => a.localeCompare(b));
}

/**
 * The acceptance suite each container runs, or `null` for one that is unit-tested where a Cargo
 * workspace exists but has no acceptance suite yet. A container that is neither mapped nor listed as
 * not-yet-covered fails the gate rather than passing green untested — `acceptanceFor` throws.
 *
 * bash, never sh: the scripts use `set -o pipefail` and other bash-isms.
 */
export const ACCEPTANCE_SUITES = new Map([
  ["scan", "containers/scan/tests/eicar_e2e.sh"],
  ["recovery", "containers/recovery/tests/recover_e2e.sh"],
  ["bundle", "containers/bundle/tests/acceptance.sh"],
  // The heaviest suite by a wide margin: the image is roughly a gigabyte because it carries an office
  // suite, which is why it runs only when this container changed.
  ["libreoffice", "containers/libreoffice/tests/acceptance.sh"],
]);
export const NOT_YET_COVERED = new Set([
  "address",
  "collabora",
  "discovery",
  "file-repair",
  "ocr",
  "raster",
  "search",
  // Unit- and fixture-tested by its own `cargo test` (tests/transcode.rs converts a file per codec
  // path); no Docker acceptance suite yet.
  "transcode",
]);

export function acceptanceFor(name) {
  if (ACCEPTANCE_SUITES.has(name)) return ACCEPTANCE_SUITES.get(name);
  if (NOT_YET_COVERED.has(name)) return null;
  throw new Error(
    `containers/${name} changed but is neither mapped to an acceptance suite nor listed as ` +
      `not-yet-covered in tooling/gate/classify.mjs — add it to one of the two.`,
  );
}
