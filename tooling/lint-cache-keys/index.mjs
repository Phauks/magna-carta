// A cache seeded under one key and restored under another warms nothing, and nothing in the runner
// says so: the pull request simply misses, builds, and looks like a cache that never existed. The gate
// (.github/workflows/gate.yml, the `build-wasm` job) restores the WASM artefacts under a key that hashes
// the Rust inputs, and seed-caches.yml saves under what must be the same key on every push to `main`
// — so the two expressions are held identical here, and editing one without the other fails the gate.
//
// Run: `pnpm run lint:cache-keys`. Pure text over the two workflow files; no install.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareKeys, GATE, SEED, wasmCacheKeys } from "./cache-keys.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function main() {
  const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
  const problems = compareKeys({
    gateKeys: wasmCacheKeys(read(GATE)),
    seedKeys: wasmCacheKeys(read(SEED)),
  });
  if (problems.length > 0) {
    console.error("lint-cache-keys: FAILED\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("lint-cache-keys: the gate and seed-caches restore the WASM artefacts under one key");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
