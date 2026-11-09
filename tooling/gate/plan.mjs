// Which dimensions a `pnpm gate` invocation runs, as a pure decision over the flags.
//
// The gate is one command with a handful of switches, and the switches compose: `--only` narrows to
// a named set, `--skip` removes from whatever is left, `--checks-only` removes the test battery. A
// name that is not a dimension is an error rather than a silent no-op — `--skip test` (singular)
// skipping nothing while looking like it worked is the one shape this must never take.

/** Every dimension, in the order the gate runs them: cheap and certain first, the battery last. */
export const DIMENSIONS = [
  "format",
  "governance",
  "audit",
  "wasm",
  "typecheck",
  "contracts",
  "startup",
  "lint",
  "rust",
  "containers",
  "test-collection",
  "tests",
];

/** Dimensions that stand up the WASM artefacts' consumers, and so cannot run when `wasm` failed. */
export const NEEDS_WASM = new Set([
  "typecheck",
  "contracts",
  "startup",
  "lint",
  "test-collection",
  "tests",
]);

export function parseList(argv, flag) {
  const names = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`gate: ${flag} needs a comma-separated list of dimensions`);
    }
    names.push(
      ...value
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    );
    index += 1;
  }
  return names;
}

/**
 * @param {object} options
 * @param {readonly string[]} [options.only]
 * @param {readonly string[]} [options.skip]
 * @param {boolean} [options.checksOnly]
 * @returns {{ selected: string[], skippedByFlag: Map<string, string> }}
 */
export function selectDimensions({ only = [], skip = [], checksOnly = false } = {}) {
  for (const name of [...only, ...skip]) {
    if (!DIMENSIONS.includes(name)) {
      throw new Error(
        `gate: "${name}" is not a dimension — the dimensions are ${DIMENSIONS.join(", ")}`,
      );
    }
  }
  const skippedByFlag = new Map();
  const selected = [];
  for (const name of DIMENSIONS) {
    if (only.length > 0 && !only.includes(name)) {
      skippedByFlag.set(name, "not named by --only");
    } else if (skip.includes(name)) {
      skippedByFlag.set(name, "named by --skip");
    } else if (checksOnly && name === "tests") {
      skippedByFlag.set(name, "--checks-only");
    } else {
      selected.push(name);
    }
  }
  return { selected, skippedByFlag };
}
