// The WASM cache key, read out of a workflow file, and the comparison the lint makes. Kept apart from
// the runner (index.mjs) so the test can drive it with text of its own.

export const GATE = ".github/workflows/gate.yml";
export const SEED = ".github/workflows/seed-caches.yml";

/**
 * The `key:` line of the WASM cache in a workflow: every value that starts with `wasm-`. Exactly one
 * per file is the expectation — a second WASM key in either would mean the seed no longer knows which
 * entry to warm — and the caller decides what to make of any other count.
 */
export function wasmCacheKeys(workflowText) {
  return workflowText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^key:\s*wasm-/.test(line))
    .map((line) => line.replace(/^key:\s*/, ""));
}

/** One message per problem; empty when the gate and the seed restore under one key. */
export function compareKeys({ gateKeys, seedKeys }) {
  const problems = [];
  if (gateKeys.length !== 1) {
    problems.push(`  ${GATE} holds ${gateKeys.length} WASM cache key(s); expected exactly one.`);
  }
  if (seedKeys.length !== 1) {
    problems.push(`  ${SEED} holds ${seedKeys.length} WASM cache key(s); expected exactly one.`);
  }
  if (gateKeys.length === 1 && seedKeys.length === 1 && gateKeys[0] !== seedKeys[0]) {
    problems.push(
      `  the WASM cache key differs between the gate and the seed — a seed under a different key warms nothing:\n` +
        `    ${GATE}:        ${gateKeys[0]}\n` +
        `    ${SEED}: ${seedKeys[0]}`,
    );
  }
  return problems;
}
