import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { fitnessMemberFiles, FITNESS_SCOPES_ENV } from "./repo-wide.mjs";

// The repo-wide fitness SWEEP — a re-runner, not a test project.
//
// It owns no tests. Every file it runs already belongs to its own package's Vitest project and runs
// there under `pnpm test`; this config exists only so the inner-loop gate can run that subset in one
// process without paying for the root workspace. Measured: the same nine files cost 8.5 s through the
// root config (which resolves ~70 project configs before it filters) and 3.1 s through this one. That
// difference is the whole reason the sweep is affordable in a command people run dozens of times an
// hour.
//
// Because it owns no tests it is deliberately NOT in `test.projects` in the root vite.config.ts:
// registering it would run every member twice in the whole-repo suite and break the shard-union
// arithmetic in `lint:test-collection`. tooling/lint-test-registration.mjs knows about that and
// records it as a declared re-runner rather than an unregistered project.
//
// The include list is DISCOVERED, not written here: repo-wide.mjs scans for the `@repo-wide-fitness`
// directive in test-file headers. Adding a repo-wide check to the gate is a comment in the check's own
// file — there is no roster to remember to edit.

const root = fileURLToPath(new URL("../..", import.meta.url));

// Which scopes this run covers, chosen by the caller. `source` is every check that reads first-party
// source; `schema` adds the ones whose only input is the Drizzle schema (see repo-wide.mjs for why
// they are triggered separately). Default `source` so a bare run of this config is the common case.
const scopes = (process.env[FITNESS_SCOPES_ENV] ?? "source").split(",").filter(Boolean);
const include = fitnessMemberFiles({ root, scopes });

if (include.length === 0) {
  // A sweep that matches nothing exits 0 having proved nothing — the exact failure this gate exists
  // to close. Fail at config load instead, where the message can name the cause.
  throw new Error(
    `repo-wide fitness sweep: no test file declares @repo-wide-fitness for scope(s) ${scopes.join(", ")}. ` +
      "Either the directive scan is broken or every member was de-registered; neither is a passing run.",
  );
}

export default defineConfig({
  test: {
    name: "repo-wide-fitness",
    root,
    include,
    // Every member is a read-only scan — it walks source files or introspects the Drizzle schema, and
    // none of them writes a file, a global, or a database. Isolation buys nothing against that and
    // costs 0.6-2.0 s of worker setup depending on the scope, so it is off HERE and only here. The
    // authority remains each member's own package project under `pnpm test` / CI, which is isolated
    // the ordinary way; this config is a fast pre-check in front of that, never a replacement for it.
    // A member that ever needs isolation is a member that stopped being a pure scan.
    isolate: false,
  },
});
