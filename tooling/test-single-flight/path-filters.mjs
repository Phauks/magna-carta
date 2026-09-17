// How `pnpm test <path>` turns a path a human typed into a filter the runner actually resolves.
//
// A RELATIVE path that names an ancestor of a project's root matches nothing in that project, and the
// run reports having found no test files. So `tooling` selects nothing — every `tooling/*` project
// roots at its own directory, and the filter is above all of them — and the same goes for `packages`
// and `apps`. An ABSOLUTE path takes a different branch and does resolve. The full matching rule,
// and the other trap that shares its shape, are in docs/conventions/build-performance.md — one home.
//
// That spelling was not a style choice: a relative `packages` filter once collected zero of the
// packages' tests while the gate stayed green. But the root CLAUDE.md tells everyone to filter by PATH
// rather than by test name, so the short spelling is the one people type, and it was the broken one.
// Resolving a directory filter to its absolute path before the runner sees it gives every caller the
// gate's idiom without having to know it exists.
//
// The decisions live here as pure functions over an injected filesystem view so they can be tested
// without a repo to run against; the spawning half is index.mjs. See docs/conventions/build-performance.md.

/**
 * The runner's subcommands. The first argument may be one of these rather than a filter, and a
 * subcommand never names a path, so it is skipped rather than inspected.
 */
export const SUBCOMMANDS = new Set([
  "bench",
  "complete",
  "dev",
  "init",
  "list",
  "related",
  "run",
  "watch",
]);

/**
 * Options whose next argument is a NAME or a PATTERN rather than a path — the only options whose
 * value could sit where a filter sits and be actively harmed by being resolved to a path.
 *
 * The list is deliberately not "every option that takes a value". Most that do take a path
 * (`--config`, `--root`, `--dir`, `--outputFile`), and resolving one of those to an absolute path
 * means the same thing it already meant, so mistaking it for a filter costs nothing. Only these carry
 * a value where a path would be wrong, so only these need skipping — which keeps this list short
 * enough to stay true, instead of being a copy of the runner's whole option table drifting quietly out
 * of date.
 *
 * If the list is ever incomplete, the miss requires the option's value to also be the name of a real
 * directory in this repository, and it then fails loudly (an unknown project, a pattern matching
 * nothing) rather than silently running the wrong set. The `--option=value` spelling carries its own
 * value and never consumes what follows it, so it needs no entry.
 */
export const NAME_VALUED_OPTIONS = new Set([
  "--browser",
  "--environment",
  "--mode",
  "--pool",
  "--project",
  "--reporter",
  "--shard",
  "--testNamePattern",
  "-t",
]);

/**
 * Which arguments are candidate path filters: everything except the options, the value of one of the
 * name-valued options above, and a leading subcommand.
 */
export function candidateFilters(argv) {
  const candidates = [];
  for (const [index, token] of argv.entries()) {
    if (token.startsWith("-")) continue;
    if (index === 0 && SUBCOMMANDS.has(token)) continue;
    if (index > 0 && NAME_VALUED_OPTIONS.has(argv[index - 1])) continue;
    candidates.push({ index, token });
  }
  return candidates;
}

/**
 * Resolve the directory filters in an argument list, and report the ones that provably cannot match.
 *
 * `inspect(token)` is the filesystem view. It returns `undefined` when the token does not name a
 * directory in the repository — a substring filter like `select.test.mjs`, an option's value, a
 * single file — and those are passed through untouched, because a token this function cannot
 * identify is a token it has no business rewriting.
 *
 * For a directory it returns `{ absolutePath, holdsProject }`. `holdsProject` is whether any vitest
 * project lives at, under, or above that directory. When it is false, NO test file under the path can
 * be collected however the filter is spelled, so the run is refused here instead of downstream: the
 * runner's own answer is "No test files found", which reads as *this directory has no tests* when
 * what actually happened is *your filter selected nothing*. Those are different facts and only one of
 * them is ever true, so the message says which.
 *
 * The refusal is deliberately the only one. A directory that DOES hold a project but whose files the
 * project's `include` globs happen not to cover is left to the runner: proving that case would mean
 * re-implementing glob resolution here, and a wrong refusal blocks a run that would have worked.
 */
export function planPathFilters(argv, inspect) {
  const planned = [...argv];
  const resolved = [];
  const refusals = [];
  for (const { index, token } of candidateFilters(argv)) {
    const directory = inspect(token);
    if (directory === undefined) continue;
    planned[index] = directory.absolutePath;
    if (directory.holdsProject) {
      resolved.push(token);
      continue;
    }
    refusals.push(
      `"${token}" holds no vitest project, so no test file under it can be collected — the filter ` +
        `matched nothing, rather than the directory being empty of tests. The project list in ` +
        `vite.config.ts is CLOSED: a directory is only reachable when a registered project roots at ` +
        `it, above it, or inside it. If it should have one, register it there — ` +
        `\`pnpm run lint:test-registration\` audits that.`,
    );
  }
  return { arguments: planned, resolved, refusals };
}
