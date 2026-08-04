import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Fitness function for the root vitest project registry (mirrors lint-status.mjs). The `test.projects`
// list in vite.config.ts is CLOSED: a vitest config that exists on disk but is not covered by an entry
// belongs to a project the runner never loads, so its tests run nowhere — locally and in CI — and
// nothing fails on their absence (`--passWithNoTests` can only guard paths that reach the runner).
// This scan makes that hole impossible to reopen: every `vitest*.config.ts` under a workspace group
// must be matched by a registry entry, and every literal (non-glob) entry must point at a file that
// exists. Run: `pnpm run lint:test-registration`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The workspace groups that can hold test projects (pnpm-workspace.yaml's package roots + tooling,
// which registers its test-bearing subdirectories individually).
const GROUPS = ["apps", "packages", "plugins", "tooling"];

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

if (errors.length > 0) {
  console.error("lint-test-registration: the vitest project registry and the disk disagree:\n");
  for (const error of errors) console.error(error);
  console.error("");
  process.exit(1);
}

console.log(
  `Test-project registry covers all ${discovered.length} vitest configs on disk (${entries.length} entries).`,
);
