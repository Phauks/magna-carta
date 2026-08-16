import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Fitness function for the root vitest project registry (mirrors lint-status.mjs). The `test.projects`
// list in vite.config.ts is CLOSED: a vitest config that exists on disk but is not covered by an entry
// belongs to a project the runner never loads, so its tests run nowhere — locally and in CI — and
// nothing fails on their absence (`--passWithNoTests` can only guard paths that reach the runner).
// This scan makes that hole impossible to reopen: every `vitest*.config.ts` under a workspace group
// must be matched by a registry entry OR declared a re-runner below, and every literal (non-glob)
// entry must point at a file that exists. Run: `pnpm run lint:test-registration`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The workspace groups that can hold test projects (pnpm-workspace.yaml's package roots + tooling,
// which registers its test-bearing subdirectories individually).
const GROUPS = ["apps", "packages", "plugins", "tooling"];

// RE-RUNNERS. A vitest config that owns no tests of its own — it re-runs files that already belong to
// a registered project, in one process, for a caller that cannot afford the root workspace. The
// premise this lint is built on ("unregistered means its tests run nowhere") is simply false for one
// of these, and registering it would be actively wrong: the whole-repo suite would run every member
// twice and the shard-union arithmetic in lint:test-collection would stop adding up. So each is named
// here with its reason, which keeps the exception visible in the lint rather than hidden behind a
// filename that happens not to match the scan.
const RE_RUNNERS = new Map([
  [
    "tooling/check-scoped/vitest.repo-wide-fitness.config.ts",
    "the inner loop's repo-wide fitness sweep — every file it includes already runs in its own " +
      "package's project (see tooling/check-scoped/repo-wide.mjs)",
  ],
]);

const viteConfig = readFileSync(join(ROOT, "vite.config.ts"), "utf8");

// Pull the quoted entries out of the `projects: [ ... ]` block. A structural change to the block that
// breaks this extraction fails loud (no entries found) rather than silently passing an empty registry.
const projectsBlock = viteConfig.match(/projects:\s*\[([^\]]*)\]/);
if (!projectsBlock) {
  console.error("lint-test-registration: could not find `projects: [...]` in vite.config.ts");
  process.exit(1);
}
const entries = [...projectsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (entries.length === 0) {
  console.error(
    "lint-test-registration: the `projects` list in vite.config.ts parsed to zero entries",
  );
  process.exit(1);
}

// An entry matches a path literally, or with `*` standing for one path segment.
function entryMatches(entry, path) {
  if (!entry.includes("*")) return entry === path;
  const pattern = new RegExp(
    `^${entry.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]+")}$`,
  );
  return pattern.test(path);
}

// Every vitest config on disk, one directory level below each group (the only layout in use).
const discovered = [];
for (const group of GROUPS) {
  const base = join(ROOT, group);
  if (!existsSync(base)) continue;
  for (const child of readdirSync(base)) {
    const childDir = join(base, child);
    if (!statSync(childDir).isDirectory()) continue;
    for (const file of readdirSync(childDir)) {
      if (/^vitest.*\.config\.ts$/.test(file)) discovered.push(`${group}/${child}/${file}`);
    }
  }
}

const errors = [];

for (const path of discovered) {
  if (RE_RUNNERS.has(path)) {
    // A declared re-runner must NOT be registered: registering it double-runs its members.
    if (entries.some((entry) => entryMatches(entry, path))) {
      errors.push(
        `  ${path}  is a declared re-runner (${RE_RUNNERS.get(path)}) but is ALSO registered in ` +
          `test.projects — that runs every file it includes twice in the whole-repo suite. Remove the entry.`,
      );
    }
    continue;
  }
  if (!entries.some((entry) => entryMatches(entry, path))) {
    errors.push(
      `  ${path}  exists on disk but no test.projects entry covers it — its tests run NOWHERE. ` +
        `Register it in vite.config.ts (and add its path to the gate's test jobs, .github/workflows/gate.yml).`,
    );
  }
}

for (const entry of entries) {
  if (!entry.includes("*") && !existsSync(join(ROOT, entry))) {
    errors.push(
      `  ${entry}  is registered in test.projects but does not exist on disk — stale entry.`,
    );
  }
}

// A re-runner named here that no longer exists is a stale declaration; say so rather than letting the
// entry sit and quietly exempt a path nobody has.
for (const path of RE_RUNNERS.keys()) {
  if (!existsSync(join(ROOT, path))) {
    errors.push(`  ${path}  is declared a re-runner in this lint but does not exist on disk.`);
  }
}

if (errors.length > 0) {
  console.error("lint-test-registration: the vitest project registry and the disk disagree:\n");
  for (const error of errors) console.error(error);
  console.error("");
  process.exit(1);
}

console.log(
  `Test-project registry covers all ${discovered.length - RE_RUNNERS.size} vitest configs on disk ` +
    `(${entries.length} entries, ${RE_RUNNERS.size} declared re-runner(s)).`,
);
