// The governance dimension's steps, as data — held apart from the runner (index.mjs) so a lint can
// read them without running the gate.
//
// The fitness sweep's environment is spelled out here as a LITERAL, deliberately not imported from
// tooling/check-scoped/repo-wide.mjs where the sweep reads it: `pnpm run lint:lints` compares the two
// spellings and fails when they differ. Importing the constant would make that comparison a
// tautology, and the failure it guards is real — rename the variable on one side and the sweep
// silently falls back to its default scope, covering half of what the step claims, on a green run.

export const FITNESS_SWEEP_CONFIGURATION =
  "tooling/check-scoped/vitest.repo-wide-fitness.config.ts";

/**
 * The repo-wide fitness sweep — the Vitest checks that self-register with `@repo-wide-fitness`: the
 * encryption chokepoint, the telemetry console ban, the off-token and bits-ui boundary scans, the
 * schema conformance checks. Both scopes, unconditionally: `source` is broken by any source change
 * and `schema` by any packages/database change, and deciding which applies is the inner loop's job
 * (tooling/check-scoped/index.mjs), not a gate's — the whole sweep is a few seconds.
 */
export const FITNESS_SWEEP_STEP = {
  name: "repo-wide fitness sweep (source,schema)",
  command: "vp",
  arguments: ["test", "run", "-c", FITNESS_SWEEP_CONFIGURATION],
  env: { MAGNA_CARTA_FITNESS_SCOPES: "source,schema" },
};

/** The steps of the governance dimension, in order. Every one is a whole-repo scan with no WASM need. */
export const GOVERNANCE_STEPS = [
  {
    // Every `lint:*` script in the root package.json, DERIVED rather than listed (repo-wide.mjs): a
    // governance lint added but never wired is a governance lint that is not running.
    // `lint:test-collection` is the one exclusion — it is its own dimension.
    name: "every lint:* script (derived, concurrent)",
    command: "node",
    arguments: [
      "tooling/check-scoped/run-repo-wide-lints.mjs",
      "--all",
      "--except",
      "lint:test-collection",
    ],
  },
  FITNESS_SWEEP_STEP,
  {
    // A plain node script rather than a test run: structural assertions over the committed
    // journal/.sql/snapshot set plus one in-memory apply. Its Vitest twin runs in the battery from the
    // same module, so this is a fail-fast, not a second implementation.
    name: "migration integrity (journal/chain/rebuild guards)",
    command: "node",
    arguments: ["tooling/migration-integrity/index.mts"],
  },
  {
    // drizzle-kit writes a snapshot only when it emits a migration, so a hand-written migration
    // advances the journal while meta/ stands still, and the next generate re-emits every table added
    // since. Unconditional and a few seconds: it drifted twice unnoticed because nothing looked.
    name: "drizzle snapshot freshness (both lineages)",
    command: "pnpm",
    arguments: ["--filter", "@magna-carta/database", "run", "check-snapshots"],
  },
];
