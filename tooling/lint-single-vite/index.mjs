// Fitness function: the lockfile resolves ONE Vite, the Vite+ core build, and never upstream `vite`.
//
// WHY THIS EXISTS. pnpm-workspace.yaml overrides every `vite` to `@voidzero-dev/vite-plus-core`, so
// one Vite runs the dev server, the build and the tests. A lockfile can still carry an upstream
// `vite@x.y.z` entry beside it: an install that adds a package (or a merge of two lockfiles) can
// resolve an auto-installed peer to the registry's `vite` and record it, and a frozen install then
// honours the lockfile, not the override. With two Vites in the tree, the Svelte plugin and SvelteKit
// carry the upstream Vite's `Plugin` type while `vite.config.ts` is checked against the Vite+ one,
// and svelte-check fails apps/web/vite.config.ts with "Excessive stack depth comparing types ... and
// 'ViteUserConfigExport'". That has landed on main twice, each time fixed by `pnpm dedupe`; this
// check fails the branch that brings it back, instead of every branch after it.
//
// THE FIX it points at: `pnpm dedupe`, then commit pnpm-lock.yaml.
//
// Run: `pnpm run lint:single-vite`. Pure text over pnpm-lock.yaml; no install.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Upstream vite package keys in a lockfile's text, e.g. `vite@8.3.7`. */
export function upstreamViteEntries(lockfileText) {
  const found = new Set();
  for (const match of lockfileText.matchAll(/(?<![\w@/-])vite@(\d+\.\d+\.\d+[\w.-]*)/g)) {
    found.add(`vite@${match[1]}`);
  }
  return [...found].toSorted((left, right) => left.localeCompare(right));
}

const SELF_TEST = [
  { text: "packages:\n  vite@8.3.7:\n    resolution: {}\n", expect: ["vite@8.3.7"] },
  { text: "  '@sveltejs/kit@2.70.4(vite@8.3.7(@types/node@26.6.6))':", expect: ["vite@8.3.7"] },
  { text: "  vite-plus@1.5.0:\n  '@voidzero-dev/vite-plus-core@1.5.0':", expect: [] },
  { text: "  '@vitejs/plugin-vue@6.0.0':\n  rolldown-vite@7.1.0:", expect: [] },
  { text: "  vite: npm:@voidzero-dev/vite-plus-core@1.5.0", expect: [] },
];

function runSelfTest() {
  for (const { text, expect } of SELF_TEST) {
    const got = upstreamViteEntries(text);
    if (JSON.stringify(got) !== JSON.stringify(expect)) {
      console.error(
        `lint-single-vite: self-test failed on ${JSON.stringify(text)}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(got)}`,
      );
      process.exit(2);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSelfTest();
  const lockfile = fileURLToPath(new URL("../../pnpm-lock.yaml", import.meta.url));
  const entries = upstreamViteEntries(readFileSync(lockfile, "utf8"));
  if (entries.length > 0) {
    console.error(
      `lint-single-vite: pnpm-lock.yaml resolves upstream ${entries.join(", ")} beside the Vite+ core ` +
        `that pnpm-workspace.yaml overrides every vite to. Two Vites break svelte-check on ` +
        `apps/web/vite.config.ts. Run \`pnpm dedupe\` and commit pnpm-lock.yaml.`,
    );
    process.exit(1);
  }
  console.log("lint-single-vite: one Vite in the lockfile (the Vite+ core).");
}
