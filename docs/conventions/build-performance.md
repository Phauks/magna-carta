# Build-time performance conventions

**Status:** Active (the playbook and the "apply it when you add something that builds" discipline apply now; concrete build-time budgets/metrics land later).

**Scope (single home for):** keeping **build time** fast — the developer feedback loop and everything that builds repeatedly in the cloud (Worker bundles, the SvelteKit SPA, Container images, Rust crates, generated artifacts). This is about how fast the build _runs_, not how fast the product runs at request time — that is runtime performance, which lives in [`performance.md`](performance.md) and golden rule 10.

**The build/deploy pipeline is Cloudflare Workers Builds**, not GitHub Actions — it builds and deploys each Worker on push to its **production branch, which is `release`, not `main`** (a push or merge to `main` builds nothing; a deploy is a deliberate `git push origin main:release`). The operator runbook (connect repo, build/deploy commands, branch control, enabling the settings below) lives in [`operations.md`](operations.md); this file is the principles and the why.

**Why this is a foundation, not a measure-first optimization.** Build caching and fast build steps are the canonical _cheap-from-the-getgo, expensive-to-retrofit_ work: you add them up front because fast feedback compounds across every push and every contributor. This sits under the **"Build when in the area"** principle (root [`CLAUDE.md`](../../CLAUDE.md), _How we work_; ADR-0078), **not** under golden rule 10's measure-first gate — you do not wait for a profile to justify a cache. The distinction is deliberate: golden rule 10 governs runtime optimization (optimize against evidence); this file governs build foundations (add them by default).

**Distinct from disk hygiene.** Reclaiming dead build output so the disk does not fill is a separate concern, handled automatically by the post-merge `vp run clean` sweep (the auto-clean decision in the [Decision Log](../Decision-Log.md)). That deletes regenerable artifacts; this file is about making the builds that produce them fast.

## The default: anything that builds repeatedly is optimized for fast builds

When you add or change anything that builds in the cloud — a new Worker, a Container image, a code-generation step — make it fast by default. The standing techniques, in rough order of leverage:

### Use Workers Builds' native caching and path scoping

Workers Builds is the build surface, so its own settings are the first lever (configured per Worker in the dashboard — see [`operations.md`](operations.md)):

- **Build Caching — on.** Caches dependencies and build outputs across builds in a project-wide cache, so a build does not re-download the pnpm store or rebuild unchanged outputs every time. This is the cloud-build analog of a CI dependency cache and the single biggest win.
- **Build Watch Paths — scoped per Worker.** In a monorepo, scope each Worker to the paths it actually depends on so an unrelated change does not trigger a full rebuild of every Worker (e.g. `magna-carta-scan` watches `containers/scan/**` and its package; `magna-carta` watches the worker/web/shared paths and excludes `containers/**`). This is "build only what changed" at the pipeline level.

Caching only helps if inputs are stable, so **commit lockfiles** (`pnpm-lock.yaml`, `Cargo.lock`) and pin versions, and install with `--frozen-lockfile` — a moving input is a permanent cache miss.

### Cache the heavy compiles inside a build

For work the build itself repeats — chiefly native compiles — cache within the build so an unchanged dependency graph is not rebuilt:

- **Rust / Docker** — build the Container image with BuildKit cache mounts (`--mount=type=cache`) on `/usr/local/cargo` and the crate `target/` so dependency compiles are reused. A cache mount is not part of an image layer, so copy the built binary out to a non-mounted path in the same `RUN` before the stage ends (see `containers/scan/Dockerfile`).
- **Order Dockerfiles slow-changing-first** — system packages, then dependency manifests, then source — so an unrelated source edit does not invalidate the heavy layers.

Note: BuildKit cache mounts are build-local. Persisting them across Workers Builds runs (a cache-mount export) is the documented upgrade path if cold dependency compiles become the bottleneck — not done up front.

### Trim the work the build has to do

- **Multi-stage Docker builds** — keep the toolchain in a build stage; ship a slim runtime image with no compiler, intermediates, or caches.
- **Lean build context** — a `.dockerignore` that excludes `target/`, `node_modules/`, and other heavy regenerables keeps context transfer small.
- **Minimal feature/dependency sets** — compile only what the artifact needs (e.g. default-off optional native backends, trimmed crate features) so the build pulls and compiles less.
- **Respect the dependency graph; never build an artifact twice** — `vp run build-all` builds the SPA once and orders the Worker after it through the vp task graph; do not add steps that rebuild the same output.

### Move slow inputs to build time, not run time

Work that would otherwise happen on every cold start belongs in the image, fetched and pre-processed once at build time: baked databases, compiled/serialized rule blobs, prebuilt indexes. The scan Container is the worked example — it bakes the ClamAV signature DB and a compiled YARA-rule blob at build time, so the runtime container neither downloads nor recompiles them. This trades a slightly longer build for a fast, network-free start; prefer it whenever a runtime input is large and slow-changing.

## Type-checking and static analysis — the local feedback loop

The other half of "build time fast" is the **static-check loop** every contributor runs constantly:
`vp check` (format + lint + type-check) and the per-package `tsc --noEmit` / `svelte-check` passes.
Its cost profile is uneven, and knowing where the cost is prevents optimizing the wrong thing:

- **Format (`oxfmt`) and lint (`oxlint` + the `tsgolint` type-aware path) are already Rust-native and
  fast** — whole-repo formatting checks finish in seconds. They are not the bottleneck and need no
  structural work; keep them enforced (below) rather than sped up.
- **Full TypeScript type-checking (`tsc`) is the cost center.** It runs over the whole program with no
  incrementality, so its wall-clock scales with _total_ code, not _changed_ code — the one part of the
  loop that gets worse as the monorepo grows. A scoped type-check of a few files is seconds; a cold
  whole-repo type-check is minutes.

The techniques, in leverage order:

### Scope the check to what changed (now)

**The full gate (`pnpm check`)** runs `vp check` (fmt + lint) and **`vp run typecheck` (`tsc -b`) as the
authoritative type-check** — `tsc -b` is fast and incremental, so the type pass actually completes and
a type error can no longer slip (`vp check`'s own whole-repo type-error pass is off;
`typeCheck: false`). It builds **two** root solutions, `tsconfig.build.json` (every package's `src/`)
and `tsconfig.test.json` (every package's `test/`), which between them cover the whole workspace with
nothing held out — see _Two projects per package: source emits, tests only check_ below.
It is exhaustive and slow by design, and it is the **gate of record — run in GitHub Actions**
(`.github/workflows/gate.yml`, alongside the full `vp test`) on every pull request and push to `main`,
not on the inner loop.

**Cheap and certain first, expensive and fragile last.** The chain leads with the two checks that cost
seconds and cannot fail spuriously — the build-reference sync and the drizzle snapshot freshness — and
only then reaches the format, lint and type passes that take minutes. The ordering is not cosmetic: a
run that dies partway reports nothing about the steps behind the one that died, and the type-aware lint
pass (tsgolint over ~3,300 files) has been observed OOM-killed at step one in a container, which took
the whole chain down before any of the cheap checks had spoken. Put the seconds-long, high-signal
checks where a partial run still answers them.

**The fast local loop — and the pre-push hook — is `pnpm check:scoped`** (`tooling/check-scoped/`). It
derives the change set from the git diff (the merge-base with the trunk, plus the working tree) and runs only
what that change can break: fmt + lint on the changed paths, and the incremental `tsc -b` type-check,
`svelte-check`, the drizzle snapshot freshness check or the Rust gate **only when something that can
reach each was actually touched** — respectively a path in the TypeScript project graph, a `.svelte`
file, the schema package, a crate. It prints what it skipped and why — a gate that quietly checks
nothing is worse than a slow one.

**And it runs the repo-wide set, which is deliberately NOT scoped to the diff.** See _The repo-wide
tier_ below: some checks are structurally unreachable from a diff-scoped gate, and leaving them to a CI
tier that could be down is how three red merges happened in one session.

The conditional passes are conditional on **cost**, not on importance, and the bar for adding one is the
same each time: it has to be cheap enough that the change set which triggers it does not notice. The
snapshot check (`pnpm --filter @magna-carta/database run check-snapshots`, both lineages, ~3 s) clears
that bar easily and is triggered by any change under `packages/database/` — a wider trigger than strictly
necessary, chosen because reasoning about which file reaches the drizzle generator costs more than the
three seconds. It also runs **unconditionally** in the whole-repo `pnpm check` and in the CI gate's
`governance` job, next to the migration-integrity test: drift there is silent, survives a merge, and only
surfaces weeks later when someone runs `generate` and gets a destructive table rebuild instead of one
`ALTER`. Why the snapshot lags in the first place, and how to repair it, is
[`packages/database/CLAUDE.md`](../../packages/database/CLAUDE.md) — the failure message names the repair
command inline, so a reader who hits the gate never has to go looking.

**Fix the same scope you check: `pnpm fix:scoped`** (`tooling/check-scoped/fix.mjs`) is the default way
to apply the formatter and the lint autofixes, and a bare repo-wide `vp check --fix` is not. Given no
paths, `vp check --fix` rewrites the whole repository — it has landed dozens of files nobody in the
change had touched. `fix:scoped` runs over exactly the change set `check:scoped` verifies — the two
share one implementation (`changed-files.mjs`), so the set fixed and the set checked cannot drift — and
includes markdown and the other prose/data formats. Each pass gets only the paths it can parse:
`.svelte` is lint-only (no Svelte formatter), markdown / JSON / CSS / HTML / YAML / TOML are
format-only (no lint rules for them), scripts take both. `pnpm fix:scoped --no-lint` skips the
autofixes entirely when only the formatting is wanted, and `--base <ref>` scopes it like the gate.
Rust is not in scope — that is `cargo fmt`.

Which trunk ref that merge-base is taken against is not a detail: a worktree whose local `main` is frozen
at clone time (every agent worktree) would otherwise be diffed against an ancient commit, and the
"scoped" gate would lint every file the trunk has touched since. So the base is the **newest** of the
merge-bases the trunk refs offer — local `main` and `origin/main`, ordered by ancestry, not by commit
date — and `--base <ref>` still overrides it outright.

The distinction matters because the full gate's cost is nearly all fixed: seven serial whole-repo passes
run identically whether the diff is three files or three hundred, and in practice the overwhelming
majority of those runs re-confirm what was already true. Scope the local loop; keep the whole-repo sweep
in CI, where it gates the merge into `main`.

### The repo-wide tier — the checks a diff-scoped gate structurally cannot find (now)

A **repo-wide** check is one that scans the whole repository, or a registry spread across it, and can be
broken by a change made **anywhere**. Its defining property is that it does not live in the package whose
code it governs: the console ban lives in `packages/telemetry` and binds every app's source; the PII
classification registry lives in `packages/data-access` and its input is the schema in
`packages/database`; `lint:status` reads `status.d/` fragments against `docs/active-work/` notes and is
broken by a documentation sweep.

That is not a rule of thumb, it is a measured hole. In one session `main` went red three times, each on a
different check, each merged on a diff-scoped run that **could not** have caught it — the diff never
touched the package holding the check. The tier that would have caught all three is the whole-repo one
(`pnpm check` plus the CI gate), and that tier is exactly the one that can be unavailable: GitHub Actions
started no job for eleven days under a billing block, and `pnpm check` was OOM-killed at step one until
its order was fixed. A gate you rely on being run by somebody else is not a gate.

So `pnpm check:scoped` runs the repo-wide set itself, as two clearly-labelled steps:

| Step                        | When                                             | Measured cost                             |
| --------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `repo-wide lints`           | **always**, whatever the diff                    | ~0.7 s (twelve scans, run concurrently)   |
| `repo-wide fitness sweep`   | any first-party source under `apps/`/`packages/` | ~2.5 s (nine Vitest scans in one process) |
| ... plus the `schema` scope | a `packages/database/` change                    | ~+0.6 s (ten more)                        |

Where the line is drawn, and why. **The lints are unconditional** because the diff shape that breaks them
is often docs-only — a swept stream note leaving a dangling `status.d/` pointer did exactly that, twice —
so any condition would reopen the hole. **The fitness sweep is conditional on source having changed at
all**, which is a sound precondition rather than a guess: every member reads source or the Drizzle schema,
so a documentation-only diff cannot break one, and gating on it keeps the cheapest inner loop (edit a
markdown file, run the gate) at ~1.6 s instead of ~4 s. The condition is deliberately "any source
anywhere", never "the package that owns the check" — narrowing it that way is the original bug.

Measured before and after, warm, on this machine:

| Diff shape                        | before | after  |
| --------------------------------- | ------ | ------ |
| one markdown file                 | ~0.9 s | ~1.6 s |
| one source file, ordinary package | ~2.3 s | ~4.9 s |
| a `packages/database` schema file | ~4.7 s | ~7.8 s |

**Two checks are excluded, with their numbers.** `lint:licenses` is 1.6 s — twenty times the median lint,
because it reads every installed package's license file — and its only possible input is the dependency
set, so the inner loop runs it exactly when a manifest or lockfile moves. `lint:test-collection` is 26 s
(four list-only Vitest collections over ~70 projects), an order of magnitude past the inner loop's budget,
and only a change to the CI test split can break it; its home is the gate's own `test-collection` job.
`apps/api-worker`'s route-conformance suite is 26 s as well — it runs in the Miniflare pool, which costs far
more to start than the assertions are worth here — so it stays a CI check. An honest exclusion with a
number beats a gate people disable.

**Membership derives itself; there is no roster.** A hand-maintained list of repo-wide checks is the same
bug one level up — the next one somebody writes will not be on it, and nothing will say so. So:

- The **lints** are enumerated from the `lint:*` scripts in the root `package.json`. Adding
  `"lint:whatever"` there puts it in the inner loop and in the CI `governance` job (which calls the same
  runner with `--all`), with no other edit anywhere.
- The **fitness tests** self-register with a directive comment in their own header:
  `// @repo-wide-fitness — <why the diff can't reach it>`, or `scope=schema` for one whose only input is
  the Drizzle schema. The check declares its own jurisdiction in the file a reader is already looking at.

Both mechanisms, the two deferrals, and what qualifies as repo-wide live in
[`tooling/check-scoped/repo-wide.mjs`](../../tooling/check-scoped/repo-wide.mjs). The sweep runs under its
own Vitest config rather than the root workspace — 2.5 s against 8.5 s for the same files, because the
root config resolves ~70 project configs before it filters — and that config is therefore a **re-runner**,
not a test project: every file it runs already belongs to its own package's project.
`lint:test-registration` knows about that shape and refuses to let it be registered twice.

### The fix pass applies only autofixes that are safe unattended

A lint rule has two independent jobs — telling you something, and rewriting your code — and for a few
rules those disagree: the finding is worth seeing, but the rewrite is invalid in part of this repo, or
it silently changes what a reviewer reads. `pnpm fix:scoped` runs unattended over every file in a
change, so a rewrite that is wrong even occasionally is wrong there. The excluded rules live in
`tooling/check-scoped/unsafe-autofix-rules.mjs`, each with the reason its rewrite goes wrong; today
they are:

- **`unicorn/no-array-sort`** — rewrites `.sort()` to `.toSorted()`, which is ES2023. Packages compiled
  against `lib: ES2022` (among them `@magna-carta/fixtures`) then fail with `TS2550`, and the callback
  parameters lose their inferred types with `TS7006`. Whether the rewrite compiles depends on the lib
  target of the package the file happens to sit in, which the fixer does not consult.
- **`typescript/no-unnecessary-boolean-literal-compare`** — rewrites an explicit `x === false` to `!x`.
  In the worker's access-control route metadata the explicit comparison is the deliberate spelling, and
  collapsing it to a negation changes what a reviewer of a security guard reads.

The exclusion is **fix-pass only**. Nothing about the ruleset in `vite.config.ts` changes, so
`check:scoped`, `pnpm check` and the editor still report every one of these — they just stop rewriting.
Seeing the finding and deciding is the point; having it applied while you look away is not. `fix:scoped`
prints the excluded rules at the end of every run, so what it declined to do is never invisible.

Mechanically, that is why the fixer drives the two halves of `vp check --fix` separately: the formatter
through `vp check --fix --no-lint`, and the lint autofix through `vp lint --fix -A <rule>`. `vp check`
rejects the linter's `--allow` flag outright, so one combined invocation cannot express the exclusion.
Adding a rule to the list is a deliberate act — state the rewrite that goes wrong and where, not just
the rule name.

### One test run per worktree — `pnpm test`, not a bare `vp test`

**`pnpm test` is the entry point to the test runner** (`tooling/test-single-flight/`). It is `vp test`
with every argument passed through untouched, plus a per-worktree single-flight lock.

Two test runs started in the same worktree contend for the same on-disk state — the Vite transform
cache, the `.wrangler` state each Miniflare worker suite stands up, and the runner's own worker pool.
The observed failure is not a crash but a **wedge**: both processes sit at 0% CPU and neither finishes,
so the run reads as slow rather than broken, and the natural response is to wait and then start a
third. The lock turns that into a refusal in milliseconds, naming the run already in flight and the
command it is running. It is reclaimed automatically when the holding process is gone or the lock is
older than 90 minutes, so a run killed with `SIGKILL` can never leave a worktree unable to test.
`MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1` skips it for the deliberate case.

**A closed output pipe ends the run rather than wedging it** (`tooling/test-single-flight/broken-pipe.mjs`).
`pnpm test | head` is the obvious thing to type against a long suite, and `head` exits as soon as it has
its lines. Node ignores `SIGPIPE` and turns the failed write into an asynchronous `EPIPE` on the stream,
so a reporter that swallows that error neither finishes nor makes progress: the run sits at 0% CPU
**still holding the lock**, which is indistinguishable from the contention the lock exists to prevent and
so sends the diagnosis to the wrong place. It has to be cleared by hand. Note that pid-based reclaim
cannot help — the holder is blocked, not dead, so a liveness probe correctly reports it alive and
correctly refuses the next run. The guard therefore notices the broken pipe itself, tears the run down,
releases the lock, and exits **141** (the conventional `128 + SIGPIPE`, so a run cut short is neither a
pass nor mistaken for a test failure). Because a parent using `stdio: "inherit"` cannot observe the
child's failed writes at all, the child's output is forwarded through the parent whenever stdout is not a
TTY; on a TTY there is no reader that can walk away, so `inherit` is kept and interactive behaviour is
byte-for-byte unchanged.

**Ending the run ends the RUNNERS, not just `vp`** (`tooling/test-single-flight/process-group.mjs`).
`vp` is two levels above the thing doing the work: under it sits the Vitest CLI, and under that the
esbuild services and the workerd instances the Miniflare suites stand up. Signalling only the direct
child orphans the rest, and they keep the CPU, the transform cache and the `.wrangler` state. Measured
here, interrupting `pnpm test apps/api-worker`: the guard exited after 17 s and **released the lock with
nine runner processes still alive**, which stayed up for a further **44 s**. The next `pnpm test` then
claims the lock correctly — its holder really is gone — and starts into the previous run's live
runners, which is the contention the lock exists to prevent arriving through the one door it does not
watch. It presents as timeouts in files neither run touched.

So the runner is spawned **detached**, leading its own process group, and teardown is SIGTERM to the
group, a 2 s grace, SIGKILL for the remainder — and the lock is released only once the group is
confirmed **empty**, never merely once the direct child has exited. The wait is bounded (a survivor is
reported and the lock released anyway), because a lock held until an unkillable runner dies would be the
very 0%-CPU holder this guard exists to eliminate. Same target after the change: **zero survivors, lock
released clean.**

Detaching is gated on **stdin not being a terminal**, which is the shape of the hazard rather than a
proxy for it: a detached process that reads its controlling terminal from a background process group
takes `SIGTTIN` and stops, which would wedge `vp test --watch` on its keypress reader. No terminal on
stdin, no such read, no `SIGTTIN`. The gate costs nothing where it declines, because an interactive run
sits in the terminal's **foreground** process group and Ctrl-C is delivered by the kernel to every
process in it. One residual gap, named rather than papered over: an interactive terminal with only
stdout redirected (`pnpm test | head` typed at a prompt) keeps the single-child teardown, since stdin is
still the terminal. Windows has no process groups to signal, so the tree-kill there is `taskkill /T /F`
— implemented, but the numbers above are POSIX and that branch is unmeasured.

A bare `vp test` is unguarded — it is the invocation that produces the wedge — so reach for `pnpm test`.
CI is unaffected: its shards run in separate containers, each with its own filesystem, and each shard
invokes the runner directly.

While filtering a run: **pass file or directory paths, not a name filter.** `vp test run --project=X`
followed by `-- <name>` does not narrow the run — the trailing filter is dropped and the whole project
executes (verified on `@magna-carta/fixtures`: 14 files ran with the filter in place), and on some
machines the same invocation hangs outright. `pnpm test run packages/ledger/test/posting.test.ts` is
the reliable spelling.

#### A positional path is matched per project, against that project's own root

The corollary, and the sharp edge: **a relative path that names an ancestor of a project's root matches
nothing in that project, and the run reports a green zero.** The runner does not compare your filter
against the repository-relative path. For each project it takes the candidate file's path _relative to
that project's own root_ and asks whether the filter is a substring of it — or, failing that, whether
`relative(projectRoot, filter)` is. So under project `packages/ledger`, a test file is
`test/posting.test.ts`; the filter `packages` appears nowhere in that, and `relative` reduces it to
`..`, which appears nowhere either. Every package drops out.

That is why `pnpm test run packages/ledger/test/posting.test.ts` works while `pnpm test run packages`
runs nothing: a path that resolves **exactly to a project root** reduces to the empty string, which is a
substring of everything, so the whole project is selected; a path **inside** a project matches by
substring; a path **above** one matches nothing.

**How that fails matters, and it is not "silently green".** When _nothing at all_ matches, the runner
does fail: it prints `No test files found, exiting with code 1` and exits **1** — measured on this
version across `run`, `--shard=i/N` and `--project` alike (`passWithNoTests` is deliberately left off).
The dangerous case is the **partial** one. A filter set that matches _some_ files collects those and
exits **0**, with no mention that a sibling filter contributed nothing: substituting one relative path
for its absolute spelling alongside a good one collected 34 files and reported a confident green
`Test Files 34 passed (34)`, two orders of magnitude short of that selection's real size (run
`pnpm run lint:test-collection` for the current figures). So an under-scoped filter is
indistinguishable from a fast suite **only when it still matches something** — which is exactly the case
a multi-path CI job is exposed to, and why the count needs an independent check
(`tooling/lint-test-collection/`) rather than a reading.

Two rules follow, and CI depends on both:

- **Filter with absolute paths.** An absolute filter takes a different branch entirely — a prefix test
  against the file's absolute path — so `"$PWD/packages"` selects every package's tests, which is what a
  reader expects the relative form to do. Every path in the gate's test jobs is spelled `"$PWD/..."` for
  this reason.

  **`pnpm test` now does this for you**, so the relative form is no longer the broken one: a positional
  filter naming a directory in the repository is resolved to its absolute path before the runner sees it
  (`tooling/test-single-flight/path-filters.mjs`), which is why `pnpm test tooling` collects all 35 of
  that directory's files. Anything that is not a directory here — `select.test.mjs`, an option's value —
  is passed through untouched, because a token the wrapper cannot identify is one it has no business
  rewriting. CI is unchanged and still spells its paths absolutely: its shards invoke the runner
  directly, so nothing resolves them on the way through.

- **At most one negated `--project`.** Project patterns are OR-ed (`.some`), and a negation compiles to
  "any name that is not this one". Two negations therefore cancel: `--project='!a' --project='!b'`
  matches project `a` (it satisfies `!b`) and project `b` (it satisfies `!a`), so the filter degenerates
  to no filter at all — again silently. Exclude one project by name; select the rest positively.

**A selection that provably cannot match is refused, and says so.** "No test files found" is the
runner's answer to both _this directory holds no tests_ and _your filter selected nothing_, and only one
of those is ever true — the same silent-narrowing shape as a truncated path list. `pnpm test` refuses
before it takes the single-flight lock when a directory filter has no vitest project at, above, or
inside it, because the project list in `vite.config.ts` is closed and no such path can yield a file
however it is spelled. That is the only refusal: a directory that does hold a project but whose
`include` globs happen not to cover it is left to the runner, since proving that case means
re-implementing glob resolution and a wrong refusal blocks a run that would have worked.

The gate cannot rely on review to keep this right, so `pnpm run lint:test-collection`
(`tooling/lint-test-collection/`) re-runs each of the gate's test invocations in list-only mode and
asserts that the whole-suite collection clears a **committed floor**, that the union of the jobs equals
it, that the jobs do not overlap, and that the workflow holds no test invocation the lint has not been
told about — the list is closed in both directions, so a fourth test job cannot quietly take a share of
the suite the coverage check then credits to nobody. The floor and its update procedure live in
`index.mjs`, next to the number; the set arithmetic lives in `collection.mjs` and is driven from
constructed inputs by `collection.test.mjs`, so each assertion is shown to bite rather than merely to
exist. It runs locally on demand and in CI as the gate's `test-collection` job.

**What it proves stops at collection.** `vp test list` resolves configs and globs files; it never
executes one, so this lint answers "which files would run", not "which files ran". The step between
them holds — measured directly at 949 registered files: test-node collects 656 and executes
`Test Files 656 passed (656)` unsharded, 328 + 328 across the two shards with nothing overlapping and
nothing dropped; test-worker collects 238 and executes `238 passed (238)`.

**Reading a run's file count: take the number in parentheses, not the one before it.** The summary
line is `Test Files <per-state counts> (<collected>)`, and the two differ whenever a collected file
produces no result — a worker that died, a browser project whose browser is not installed, a run cut
short. A local run that omitted `--project='!storybook'` on a machine without Chromium printed
`Test Files 2 failed | 684 passed (695)`: nine files collected, dispatched, and never heard from, all
of them inside the parenthetical and none of them in either state count. Comparing the `passed`
number against a collected figure therefore manufactures a shortfall out of a run that dropped
nothing, and the same subtraction is what makes a genuine drop invisible.

**Reproduce a count with `pnpm run lint:test-collection --print-invocations`, never by retyping the
paths.** `test-node` passes **fourteen** positional paths and the workflow wraps them across five
indented YAML lines. A copy that stops short does not fail — it runs a subset and reports a confident
green, the same property that made the original mis-scoped filter invisible. Truncating after the
tenth path drops `apps/{recovery,scan,search,sign}-worker`, which is **7 files and 41 tests**: the run
then prints `Test Files 649 passed (649)` against the lint's 656 and reads as a seven-file coverage
hole in the gate, when it is seven paths missing from the command. That exact mistake has now cost two
separate investigations, which is why the flag exists. The printed form drops `--shard` (there is no
runnable `--shard=0/0`, and the whole-job count is what a reconciliation wants) and keeps the quotes.

Two more traps. `--shard=i/N` is applied inside the runner's pool, after the point `list` stops, so a
sharded collection cannot be listed — it partitions a hash-sorted list by index range, which is a
partition for any N. And a count taken from one sharded job is that shard's count, not the job's:
reading `328` off a single shard and comparing it against the lint's whole-job figure reports a gap
that is only the split.

### Bootstrap the generated artefacts (a fresh worktree is not a runnable worktree)

`packages/{pdf,decryption,email}/src/pkg/` is **generated** wasm-bindgen output and **git-ignored**, so a
newly created worktree has none of it and every type-check or test touching those packages fails on an
unresolvable import until somebody rebuilds it. That is a bootstrap gap, not a per-change cost, and it
is paid once per worktree — of which several are live at any time.

**`vp run bootstrap`** (`tooling/bootstrap/`) closes it: it rebuilds only the artefacts whose Rust inputs
have actually changed, and is a sub-second no-op when everything is current, so it is safe to run at the
top of any session. `pnpm check:scoped` calls it in `--check` mode and fails fast with the fix, rather
than surfacing the gap as a confusing type error.

**That `--check` step is conditional on exactly one thing — the type-check running — and never on
anything narrower.** The distinction is the whole of it, and getting it wrong in either direction has
been tried. Skipping the artefact check on its own, because "a docs diff does not touch
`packages/pdf`", is the wrong half: `tsc -b` builds the whole project-reference graph, so a worktree
with no warm `.tsbuildinfo` type-checks `packages/{pdf,decryption,email}` whatever the diff contains,
and dropping only the prerequisite trades one message that names its own repair for **twelve `TS2307`s**
that do not — measured, on a fresh worktree with a two-file docs-only diff. That is the failure mode a
false skip always has, and it is why the artefact check is not scoped to the diff by file path.

The question that answers it is one level up: **why is the type-check itself running?** A change set of
nothing but prose cannot move a type-check result, and the artefacts are needed exactly when something
builds the graph — so the two skip together or neither does. `tooling/check-scoped/typecheck-scope.mjs`
decides, and it is written as the list of paths that **provably cannot** be an input to `tsc -b` — prose
anywhere, the `docs/` tree, and the rendered `STATUS.json` — with the type-check running unless _every_
changed path is one of them. Deny by default: a new extension, a new top-level directory, a config
nobody anticipated all take the check. A `.ts`, `.svelte`, `.mts`, a package manifest, a `tsconfig`, a
JSON fixture under `packages/`, or the lockfile all still type-check, and the gate prints which path
made it run rather than asserting the answer.

What this buys is the honest path: a branch touching only `docs/` and the ledger fragments passes its
own gate in about a second in a **fresh, un-bootstrapped worktree**, instead of building three Rust
crates (~80–100 s cold) for a pass that would not read a line of its diff. That gap is why documentation
changes were being pushed with `--no-verify`; a gate that makes bypassing it the rational choice trains
people to bypass it. A fresh worktree is still bootstrapped once before any code work, and is warm for
every later run — that cost belongs to creating the worktree, and now it is charged to the first diff
that needs it rather than to the first diff of any kind.

**Staleness is a content question, and success is a verified one.** Each output carries a stamp holding
the hash of the sources it was built from — its crate, that crate's workspace-local path dependencies,
and the workspace manifests — and after every build the emitted bindings are checked to export
everything the crate's `#[wasm_bindgen]` surface declares. Neither check is optional, because the shared
cargo target directory below makes an mtime comparison unable to see the failure that matters: a build
can be served from a cached compilation of sources that are not the ones on disk here, wasm-bindgen then
re-emits from that artefact, and the fresh mtime on the emitted files reads as "current" while the
package is missing a function it is supposed to export (the symptom is `X is not a function` at runtime,
long after the build reported success). An artefact that comes out incomplete has its crate's cargo cache
discarded, is rebuilt once, and fails the command rather than being stamped.

It also writes a **git-ignored `crates/.cargo/config.toml`** pointing cargo at a target directory shared
by every worktree on the machine (`~/.cache/magna-carta/cargo-target`). Cargo's `target/` is otherwise
per-worktree, so each new worktree pays a full cold dependency compile for the same unchanged crate
graph. Sharing makes the second worktree's build a cache hit; concurrent builds serialize on cargo's own
file lock, which is also the behaviour a 16 GB box wants. `MAGNA_CARTA_SHARED_CARGO_TARGET=0` opts out.

`vp run rust-wasm-build` (Docker, pinned toolchain) remains the **canonical** wasm build — it is what the
deploy pipeline runs, and it needs no host Rust. `vp run bootstrap` is the local fast path over the same
wasm-pack invocation; `--docker` forces the canonical images.

### TypeScript project references + incremental (the structural scaler)

Make each package a `composite` project that `references` its workspace dependencies, with
`incremental` + a `tsBuildInfoFile`. Then `tsc -b` (build mode) re-checks only changed projects and
their dependents and reads the rest from `.tsbuildinfo`; a package whose _public API_ is unchanged is
not re-checked downstream at all. Check time then scales with **changed** code — the durable fix for a
growing monorepo. The prerequisite is an **acyclic** package graph (composite references cannot express
a cycle); the workspace is acyclic today (a source-scan/graph check keeps it so), which is what makes
this a mechanical rollout rather than an untangling. The build order falls out of the existing
dependency graph.

#### Two projects per package: source emits, tests only check

`tooling/tsconfig-refs` generates **two** projects for every graph member, because one project cannot
do both jobs:

- **`tsconfig.build.json`** — `composite` + `emitDeclarationOnly` with `rootDir: "src"`, `include`
  src-only. This is what downstream packages consume; the `.d.ts` it emits is what makes the graph
  incremental. A file outside `rootDir` cannot take part in that emit, which is exactly why `test/`
  cannot join this project's `include`.
- **`tsconfig.test.json`** — `composite` (a solution file can only reference composite projects) and
  `noEmit` (no consumer imports a test), which frees it from that `rootDir`. Its `include` is
  **derived**: the package's own `include`, minus `src/**` and minus `.svelte`, plus the package's
  ambient `.d.ts` from both its root and its `src/`. So the pair covers exactly what the package's own
  `tsconfig.json` declares, and a package that adds a checkable directory gets it checked without
  anyone widening a list. It references the package's **own** build project first and then the same
  dependency build projects, so every import a test makes — `../src/thing.ts` and
  `@magna-carta/thing` alike — resolves to a declaration `tsc -b` already produced. The tests join the
  graph; no source is re-checked.

Two root solutions tie the members together and `vp run typecheck` builds both:
`tsc -b tsconfig.build.json tsconfig.test.json`. To check one package's tests and their dependency
closure, `pnpm exec tsc -b packages/<name>/tsconfig.test.json`.

**Why this exists.** Before it, the reference graph was src-only and nothing else filled the gap:
`vp check` runs with `lint.options.typeCheck: false`, so the type-aware **lint** rules reached test
files but type **errors** in them were reported by no pass in `pnpm check`, `pnpm check:scoped`, or
the CI gate, and `pnpm test` never noticed because Vitest strips types rather than checking them. The
test corpus is 885 of the workspace's 2,118 type-checkable files — 42% of it — so a green typecheck
was a statement about a little over half the repository. The backlog that surfaced when the projects
were turned on was 53 errors across 16 members, and a further 156 in `apps/api-worker` once its own
deferral was lifted; all real, and all now fixed.

**Cost.** Both roots are incremental and the test half is cheap. One machine, one session, `.tsbuild`
deleted before each cold run:

| Cold, both roots                                     |           Time |
| ---------------------------------------------------- | -------------: |
| build half alone (`tsconfig.build.json`)             |     1 min 54 s |
| both roots, `apps/api-worker`'s tests still deferred |     2 min 29 s |
| both roots, complete graph (all 71 members)          | **2 min 41 s** |

Warm, the complete pair is **1–2 s**. So the test half costs about 47 s cold over the build half, of
which `apps/api-worker` — 231 test files, more than a quarter of the corpus — is only **12 s (+8%)**: its
test project references build projects whose declarations are already emitted, so the incremental work
is checking test files and nothing else. The inner loop pays nothing, which is why `check:scoped` runs
`vp run typecheck` over the whole graph rather than skipping the test half.

#### Every member is in the solution — and what `apps/api-worker` cost to get there

`@magna-carta/api-worker` was the one member generated but held out of the root `tsconfig.test.json`, so
its 231 test files were checked by nothing. It is in now, there is no deferral mechanism left in
`tooling/tsconfig-refs/index.mjs`, and the graph is complete at 71 members. Two separate problems had
to be settled first; both are worth keeping written down, because the first is a trap anyone can walk
back into.

**One file did not type-check in 600 seconds — and the cause was not the file.**
`test/firm-database/firm-database-migration-partial-failure.test.ts` did not complete on its own with
the rest of the tree excluded, memory flat at ~2 GB, while its 26 batch-neighbours cost 2–3 s each.
The standing suspicion was the two-parameter `runInDurableObject(stub, (instance, state) => …)` form.
**That was wrong.** Bisecting to a minimal file refuted it in two steps: the two-parameter form with
`state` left contextually typed checks in 2 s, and a file containing no `runInDurableObject` at all —
just two variable declarations and two assignments — still exceeded 100 s.

The real cause is that **`@cloudflare/workers-types` ships its entire surface twice**. `index.d.ts` is
a global script (no top-level import or export), and is what `"types": ["@cloudflare/workers-types"]`
loads. `index.ts` is a parallel module declaring the same ~16,000 lines with `export` in front of
them, and, because the package publishes no `types`, `main` or `exports` field to redirect it, it is
what `import ... from "@cloudflare/workers-types"` resolves to — confirmed by `--traceResolution`,
which reports the specifier resolving to `index.ts`. A program doing both holds two distinct
declarations of every Workers interface.

Structurally identical, so nothing fails — it just gets compared. Non-generic interfaces are merely
wasteful to compare (`DurableObjectStorage` crossing the two copies costs nothing measurable). The
**generic** ones are fatal: `--generateTrace` shows `getVariancesWorker` on `DurableObjectState<Props>`
returning `in out (unreliable)`, which abandons variance and drops the checker into full structural
recursion over the mutually recursive graph hanging off it, at 200 ms+ per pair. Deleting the import
took the file from **over 600 s to 2 s**. The same import appeared in two more places including
production source, and `tooling/lint-workers-types-import.mjs` (`pnpm run lint:workers-types-import`)
now fails any package that has the globals and imports the module copy anyway. **The rule is simply:
inside a package on the worker preset, never import from `@cloudflare/workers-types` — the global of
that name is the same type and is already in scope.**

**And the backlog behind it was 156 errors**, all now fixed at the seam each one named, with no `any`,
no `@ts-expect-error`, and no production type weakened. 106 of them were one idiom — `Response.json()`
is declared `Promise<unknown>`, so reading a field off it is an error — resolved by `readJson<T>()` in
`apps/api-worker/test/support/test-auth.ts`, which makes each call site name the shape it expects. The
remainder were ordinary drift of the kind this pass exists to find, and four of them were substantive:
a proxy input type narrower than the port it stood in for (sound only through method bivariance), two
test fakes that had stopped covering fields their production types had gained, and a manifest fixture
built in a shape the contract does not accept. They are listed in the changelog fragment for this
change.

### The native compiler (TypeScript 7 / `tsgo`) — after references

The Go-native TypeScript compiler (shipping as TypeScript 7; `tsgo`) type-checks roughly **10× faster**
than the JavaScript `tsc`, from native execution plus worker-thread parallelism, and supports
`--incremental`, project references, and `-b` — so it **compounds with** the references work rather than
replacing it. Two rules govern adopting it:

- **References first, native second.** Land project references under the current (JavaScript) `tsc -b`,
  which is mature, then swap the engine to `tsgo`. `tsgo`'s `-b` orchestration of complex composite
  graphs is still stabilizing as of its RC; sequencing this way isolates the change to one variable at
  a time (our acyclic graph is the easy case, but the mature path is still taken first).
- **Keep the JavaScript compiler for Compiler-API tooling until the new API lands.** `tsgo` does not
  expose the JavaScript `typescript` Compiler API (a replacement arrives in a later 7.x). Tools that
  consume it — here, OpenAPI client generation, the database migration tool, and `svelte-check` for the
  SPA — keep a pinned JavaScript `typescript` while `tsgo` becomes the _type-checker_ for the packages
  and the Worker. Our source imports the Compiler API nowhere, so this split is clean; the SPA's
  `svelte-check` stays on the JavaScript compiler longest.

### Keep the fast checks trustworthy

Speed is worthless if the check is ignored. Format and lint must be **enforced in the pipeline** so the
tree never drifts — a repo full of format-drifted files trains everyone to skip the check and hides
real failures behind noise. Commit to the enforced formatter/linter versions (a version skew reformats
files that were already correct); pin them like any other build input.

## When you add something that builds, check

- Is Build Caching on for the Worker, and are Build Watch Paths scoped so it only rebuilds when its inputs change?
- Are lockfiles committed and versions pinned (with `--frozen-lockfile`), so the cache actually hits?
- For a Container: multi-stage, lean `.dockerignore`, slow-changing layers first, cache mounts on dependency dirs (binaries copied out)?
- Is any large slow-changing runtime input baked at build time instead of fetched on start?

## The CI gate — verify each change once at each level

`.github/workflows/gate.yml` is the gate of record, and the same change passes through it up to three
times: on its pull request, on the push that merges it, and again on the nightly sweep. Running an
identical full battery each time buys nothing — the second and third runs re-derive a result the first
already produced. So each trigger runs the pass that **only it** can run:

| Trigger        | Type-aware lint                          | Test battery | What it is for                                                                                                           |
| -------------- | ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pull_request` | full closure **minus the fan-out sinks** | full         | The tier a human waits on — optimized for latency.                                                                       |
| `push` to main | full closure **including the sinks**     | skipped      | The whole-repo type-check plus the sink lint: exactly what the pull request deliberately did not do.                     |
| `schedule`     | **whole repo**, unscoped, cold           | full         | Nightly backstop for anything the per-change tiers could miss, landing long before a deliberate `git push main:release`. |
| `merge_group`  | full closure including the sinks         | full         | Full proof of a queued merge's real post-merge tree, if a merge queue is enabled.                                        |

### TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions minutes reset

The account's GitHub Actions minutes are at their budget limit, so the cadence above is deliberately
reduced until they reset (owner decision, 2026-08-05). Every suspension carries the marker
`TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions minutes reset` in the file it touches, so
finding all of them is one `grep -r "TEMPORARY CI AUSTERITY"`.

> **The austerity was not enough, and "still running" below is aspirational, not observed.** On the
> same day this posture was written the account stopped being able to start **any** billable job, so
> the pull-request tier described as "still running" has in fact run nothing since 2026-08-05. Every
> merge since has rested on local verification alone. This is not something the workflow can fix and
> not something that reverting the austerity would fix: it clears when the owner completes the billing
> step on the [deploy queue](../deploy-queue.md). How to recognise the state — and why it is not a
> runner-label problem — is in [`operations.md`](operations.md) under _Quality gates_.
>
> **Two consequences for the revert below.** The trigger for step 1 is not "the minutes reset" on its
> own; it is **a gate run that demonstrably executed** (a job reporting a real `runner_id`). And the
> austerity's own premise should be re-examined when it does: the suspended tiers were suspended to
> conserve an allotment that has been exhausted for the whole period regardless, so restoring them
> costs whatever they cost and the saving they bought was never realised.

**Suspended** (in [`gate.yml`](../../.github/workflows/gate.yml)):

- The **`schedule`** trigger — the nightly cold whole-repo sweep, the largest recurring spend, billed
  every night whether or not anything changed. Commented out; `workflow_dispatch` remains, so the sweep
  is still runnable on demand from the Actions tab.
- The **`push` to `main`** trigger — the tier that re-verifies a tree its pull request already proved.
  Commented out.
- The **whole-repo lint tier** — the `ALL` branch of the `lint` job's scope switch, roughly 45 minutes
  of runner time on one job. Made a no-op.

**Still running:** the `pull_request` tier in full — the whole battery (format, type-check, rust, the
full test suite, governance, contracts, containers) with the type-aware lint scoped to the changed
packages and their full dependent closure minus the fan-out sinks; `merge_group`, if a merge queue is
ever enabled; `workflow_dispatch`; and [`assemble-docs.yml`](../../.github/workflows/assemble-docs.yml)
on every push to `main` (a few runner-minutes, and it is what keeps the rendered trackers current).

**What the window gives up**, precisely: the type-aware lint of a deferred fan-out sink that is in
scope only as a dependent, the whole-repo lint that a global input (the lint ruleset, the lockfile, the
shared compiler options) or a lintable file outside every package would otherwise force, and the
nightly backstop for two branches that merge in quick succession and interact semantically without
touching the same files. Type-checking, tests, and the contract checks are unaffected — they were never
scoped, and they still run whole-repo on every pull request. The first of those is covered by the merge
bar below: a full local `pnpm check` lints the whole repository, sinks included.

**The merge bar during the window.** Because the post-merge tiers no longer run, verification moves
forward to the branch: an agent runs **full local verification** on its branch before the merge (the
whole-repo `pnpm check` and `pnpm test`, not just `pnpm check:scoped`) and states the result in the pull
request, and the **orchestrator reviews** the change. A pull request whose local verification cannot be
run in full says so plainly rather than implying a gate that did not happen.

**Revert checklist** (when the gate is observed to execute again — not merely when the calendar month
turns; confirm a job reports a real `runner_id` first):

0. Confirm the account-side block is cleared: the billing step on the [deploy queue](../deploy-queue.md)
   is done, and a gate run has jobs with a non-zero `runner_id`. Until that holds, every step below
   changes only what a workflow _would_ do, and nothing about what it does.
1. `grep -r "TEMPORARY CI AUSTERITY" --exclude-dir=node_modules .` and restore each site: un-comment the
   `schedule` and `push` triggers in `gate.yml`, and restore `run_lint` in the `lint` job's `ALL` branch
   (deleting the suspension echo).
2. Delete this section and the accompanying note wherever the posture is referenced.
3. Run **one full whole-repo gate on `main`** (`gh workflow run gate.yml --ref main`) and **one nightly
   sweep equivalent** — the same dispatch is the sweep, since its empty diff resolves to "run
   everything, lint `ALL`" — to catch anything the window missed. Fix what it finds before treating
   `main` as gate-green again.
4. Only then treat a `git push origin main:release` as backed by the usual evidence.

The rest of this section describes the standing design, which resumes unchanged when the triggers do.

**Why the trimmed push-to-main run is sound.** Skipping the test battery on `main` rests on
up-to-date-before-merge: a branch that must be current with `main` in order to merge has already run the
full battery against exactly the tree that lands, so re-running it re-proves a proof. The gap it leaves
is narrow and specific — two branches that merge in quick succession and interact _semantically_ without
touching the same files, which no path filter can see. That gap is closed at its source by enabling a
merge queue (the `merge_group` trigger is already wired for it) and caught after the fact by the nightly
sweep. It is never a release risk: `main` is not the deploy branch, so nothing reaches production until
somebody deliberately pushes `main:release`, and the nightly full run always intervenes first.

**Why deferring the fan-out sinks is sound.** Which tier pays for a package's dependent re-lint is a
cost dial, not a correctness one, because the _undeferred_ closure still runs before anything can ship
— on the merge push, on the nightly sweep, and on a merge-queue build. A type flip that a change
propagates into a sink is therefore caught at merge or overnight rather than on the pull request, and
the blast radius of that delay is one type-aware lint rule: type-checking, tests and the contract
checks are never scoped and run whole-repo on every pull request. Two properties keep it a move rather
than a hole, and both are asserted mechanically by
[`tooling/affected-lint/scope-fitness.mjs`](../../tooling/affected-lint/scope-fitness.mjs): a sink the
change itself touched is never deferred, so an author's own code is always linted on their own pull
request; and the union of the pull-request scope and the post-merge scope always covers the full
transitive dependent closure.

**Why depth-capping was the wrong dial, and weight is the right one.** The pull-request tier used to
cap the dependent walk at one hop. Measured on this repository that saved almost nothing, because graph
_distance_ is a poor proxy for lint _cost_: `apps/api-worker` depends **directly** on 39 of the 61
workspace packages, so it sits one hop from nearly every change and a one-hop cap dragged it in anyway.
Cost is set by the size of the type program the linter has to build, which is a package's own files
plus everything they import — so that is what the classifier now measures, and the one package whose
type program is effectively the whole repository is the one that gets deferred. See _Fan-out sinks_
below.

**Path classification.** The `changes` job treats documentation and the rendered trackers
(`docs/**`, `changelog.d/**`, `status.d/**`, `roadmap.d/**`, every `*.md`, and `STATUS.json`) as
non-code, because nothing in the repo reads any of them at build or test time. `STATUS.json` matters
specifically: it is not markdown, so a markdown-only exclusion classified the **per-merge docs-assembly
commit** as a code change and booted the whole battery on every single merge. One exception is put
straight back — a file with a source extension is a real input wherever it lives, so a script landing
under one of those trees still counts as code.

**Shard counts follow the diff.** `--shard=i/N` partitions the same set of test files for any `N`, so
the shard count is a pure cost dial with no coverage consequence. Each shard pays a fixed few minutes of
checkout, install and artefact download before it runs a test, so on a small diff (a modest changed-file
count and a lint scope that is neither whole-repo nor a broad fan-out) `test-worker` drops from four
shards to two, halving that fixed overhead while keeping the parallelism that matters. The breadth
signal is read from the **undeferred** closure, not from the lint scope: deferring a sink narrows what
gets linted and says nothing about how broad the change is, and reading the narrowed width here would
call a foundational change small and quietly halve the test parallelism.

## The CI gate — cache what it repeats

The same principle as the Workers Builds settings above, applied to the gate: anything the fan-out
recomputes identically on every run is cached.

- **Workspace install** — the pnpm store cache makes the download free; a `node_modules` cache keyed on
  the exact lockfile hash (no `restore-keys` — a partially-matching tree is worse than none) makes most
  of the linking free. The install still runs on a hit: it re-verifies the restored tree, and the
  workspace `prepare` scripts generate files outside `node_modules` (`svelte-kit sync`) that no
  `node_modules` cache can supply.
- **Rust** — `Swatinem/rust-cache` rather than a hand-rolled `actions/cache`. It keys on the exact
  `rustc` version as well as the resolved dependency set (a hand-rolled `Cargo.lock` key silently serves
  artifacts built by a previous compiler across a toolchain bump), prunes the saved `target` down to
  dependency artifacts, and skips the save when nothing changed.
- **Container images** — the acceptance suites build through `containers/docker-build.sh`, which uses
  buildx with an external layer cache when CI sets `CONTAINER_BUILD_CACHE` and a plain `docker build`
  otherwise, so the local workflow is unchanged. The cache is scoped per container. This is the CI-side
  counterpart of the BuildKit cache mounts above: mounts are build-local, this outlives the runner.
- **TypeScript incremental state** — the `typecheck` job persists the per-project `.tsbuild` directories
  so `tsc -b` re-checks only the projects whose inputs moved. Correctness does not depend on the
  restore: `tsc` compares the content hashes recorded in `.tsbuildinfo` against the files on disk, so a
  stale or partial restore costs re-checking, never a wrong answer.
- **WASM artefacts** — built once per run and shared to consumers as an artefact, and cached across runs
  on the Rust sources (already in place).

## To formalize (later)

- Build-time budgets and a signal that flags a regression in build wall-clock, once there is a baseline worth holding.
- Persisting BuildKit **cache mounts** across Workers Builds runs (the registry/`target` mounts are build-local today) if cold Rust dependency compiles in the Container build become the bottleneck.
- **`tsgo` cutover** — swap the type-check engine to the TypeScript 7 native compiler once references have landed and it reaches GA, keeping a pinned JavaScript `typescript` for the Compiler-API tooling.
- **Break the app worker's direct dependence on nearly every foundational package.** The type-aware lint's cost is dominated by one package: building `apps/api-worker`'s whole-program type graph. Because the worker depends _directly_ on 39 of the 61 workspace packages, any change to one of them puts the worker in the affected set no matter how the dependent walk is bounded — a one-hop walk from `@magna-carta/identifiers` still covers 21 of the 24 packages the full closure covers. **Scoping is exhausted as a lever, measured in both directions** (2026-08-05): at package granularity by the fan-out above, and at _file_ granularity too — a reverse-import closure over the repository's own module graph still reaches 70–80% of the worker's 394 files for 37 of its 38 package dependencies, because `apps/api-worker/src/app.ts` mounts every route and 157 files import it. So the remaining structural fix is the dependency shape itself: the sink deferral below moves the cost to a cheaper tier, it does not remove it.

### Scope the CI type-aware lint to the affected packages (now)

The whole-repo type-aware lint (`vp check --no-fmt`, oxlint + tsgolint) is CI's tall pole — **~45 min** on a 4-core/16 GB runner (0 errors, ~820 advisory warnings over ~1850 files, measured 2026-08-04), single-threaded, no cross-run cache upstream. It was ~24 min when this section was first written; the figure tracks the package count, so re-measure it rather than trusting the number here, and raise the `lint` job's `timeout-minutes` in [`gate.yml`](../../.github/workflows/gate.yml) whenever the honest time approaches the cap. But tsgolint builds its type program **lazily from the passed files' import closure**, so `vp check --no-fmt <paths>` scopes the cost to those paths: one small package is ~2 s where the whole repo is ~45 min (measured). The earlier belief that this "depends on a vp mechanism to scope `typeAware`" was wrong — the `vp check [PATHS]` passthrough already is that mechanism, and cross-package types still resolve from the closure.

So the gate's **`lint` job lints only the affected packages**, computed by `tooling/affected-lint`: the changed workspace packages **plus their dependents** — never just the changed files, because a type-aware finding in an unchanged file can flip when a dependency changes (that soundness gap is exactly why `check-scoped`, which lints only changed files, is fine for the local loop but not a merge gate). The walk is **unbounded on every trigger** (`--max-hops all`); the pull-request tier's cost lever is the fan-out sink deferral below, not a depth cap. A change to a global input — the lint ruleset and the shared compiler options (`vite.config.ts` — which is both the lint ruleset home and where `typeAware` lives — plus `tsconfig.base.json`, `packages/tsconfig/`), the lockfile, or the affected-lint logic itself — falls back to a whole-repo lint, as does any lintable source file outside every package (which is what still re-lints the whole repo for a JS-based action under `.github/`). A workflow or action **YAML** change (e.g. `gate.yml`) is deliberately **not** a trigger — it cannot move a type-aware lint result, so it does not pay the whole-repo pass. Only the lint job is scoped this way; type-check, tests, and the contract checks still run whole-repo, so the blast radius of a scoping miss is one type-aware lint rule, not correctness at large. A typical few-package change drops the tall pole from ~45 min to seconds; a foundational package (e.g. `@magna-carta/identifiers`) correctly re-lints its whole dependent set. (**TEMPORARY CI AUSTERITY 2026-08-05 — revert when Actions minutes reset:** the whole-repo fallback described here is suspended; the scoped pass is untouched. See the austerity note under _The CI gate — verify each change once at each level_.)

### Fan-out sinks — defer the one package whose lint is a whole-repo lint (now)

Scoping alone did not finish the job. On a measured pull-request gate run (2026-08-05, 17 jobs) the
`lint` job billed **26 minutes of ~60 for the whole run — 43% of the bill** — at the _cheap_ scoped
tier, and [the CI evaluation](../research/2026-08-05-cloudflare-ci-evaluation.md) named the cause: the
scope was correct, and it contained `apps/api-worker`.

**The cost model.** The type-aware linter builds its type program lazily from the passed files' import
closure, so a package's lint cost tracks the **size of that program** — the package's own lintable
files plus every lintable file in its transitive _dependency_ closure. That is the opposite direction
from the dependent walk the scope is computed with, and it is what makes one package's lint seconds and
another's half an hour. Call it the package's **type-program weight**. Measured 2026-08-05 across 61
workspace packages and 1,669 lintable files: `@magna-carta/api-worker` weighs **1,261 files — 75.6% of the
repository**. The next package down is `@magna-carta/fixtures` at 550 (33%), and the median package
weighs 34 (2%). Linting the worker is, to within rounding, a whole-repo lint.

The consequence is stark, and it is why package **count** is the wrong unit for this scope. Measured on
a 4-core/15 GB box, 2026-08-05, for a change to `@magna-carta/identifiers`:

| `vp check --no-fmt <scope>`                              | Files linted |  Wall clock |
| -------------------------------------------------------- | -----------: | ----------: |
| `packages/identifiers` alone                             |           20 |   **2.3 s** |
| the 28-package pull-request scope with the sink deferred |          883 |     **9 s** |
| `apps/api-worker` alone                                  |          394 | **2,755 s** |

Twenty-eight packages and 883 files finish in nine seconds. One package and 394 files take
three-quarters of an hour, because the type program behind those 394 files is the repository.

**The rule.** A package is a **fan-out sink** when its type-program weight is at least half the
workspace's lintable files (`FANOUT_SINK_SHARE` in
[`tooling/affected-lint/index.mjs`](../../tooling/affected-lint/index.mjs)). The share is deliberately a
ratio rather than a file count, so it needs no re-tuning as the repository grows — the claim it encodes
is "linting this package is effectively a whole-repo lint", which is proportional. On a pull request
the classifier drops the sinks from the scope **when they are in scope only as a dependent**; every
other trigger passes no such flag and lints them. A sink the change itself touched is never deferred.

**Why that is a move and not a hole.** Type-aware findings in a sink can only flip through what the
sink imports, so deferring them delays a class of finding, it does not discard it: the undeferred
closure runs on the merge push, on the nightly sweep, and on a merge-queue build, all before a
deliberate `git push main:release` can turn anything into a deploy. Two invariants make that argument
mechanical rather than rhetorical, and
[`scope-fitness.mjs`](../../tooling/affected-lint/scope-fitness.mjs) (`pnpm run lint:affected-scope`,
wired into the gate's `governance` job) asserts both for a simulated change to **every** workspace
package: the pull-request scope always contains the changed package itself, and the union of the
pull-request scope and the post-merge scope always contains the package's full transitive dependent
closure. It derives that closure by an **independent fixpoint** over the same package graph the
classifier reads — a different algorithm on one source of truth, so a mistake shows up as a
disagreement instead of as two copies of itself. It also fails if the sink rule ever stops selecting an
outlier: no sink at all (the flag would be a silent no-op), more than two sinks, or a sink weighing
less than 1.5x the heaviest non-sink.

**Two refinements measured and rejected, so they are not re-proposed.** Both look obvious and neither
pays here:

- **File-granular scoping** — the changed files plus the transitive reverse-import closure over the
  repository's own module graph, resolved with the TypeScript resolver rather than guessed. Sound in
  principle, and measured worth roughly a quarter of the worst case: for **37 of the worker's 38
  package dependencies the closure still reaches 70–80% of its 394 files**, because
  `apps/api-worker/src/app.ts` mounts every route and 157 files import it. That buys a fraction off the tall
  pole in exchange for a module-resolution graph whose failure mode — a specifier that quietly resolves
  to nothing — is silent under-linting on a merge gate. Not worth it until the hub itself is broken up.
- **Content-hash caching of a package's lint result**, keyed on the package plus its dependency
  closure. It misses precisely when it is needed: the key must cover the closure for the result to be
  reusable, and a foundational change is by definition a change inside that closure. It would hit on
  re-runs of an unchanged tree and miss every expensive case.

**Keeping the rule honest.** When the app worker's dependency shape is finally broken up (see _To
formalize_), the sink rule will stop selecting anything and `lint:affected-scope` will fail — which is
the intended signal to delete `--defer-fanout-sinks` and this section rather than to widen the
threshold. Never widen a threshold to make a red run green.

### Shard the CI test suite across parallel runners (now)

The tests are deliberately **not** affected-scoped — a change in a foundational package can break a consumer's test that a dependency-graph scope would miss, and a missed test failure is a correctness hole, not (as with lint) one type-aware rule. So instead of _scoping_ the tests, the gate _shards_ them, and it shards along the suite's **natural project boundaries** rather than one blind shard over everything. The suite has three substrates with very different per-file cost and setup — plain node units (milliseconds), the Miniflare Workers pool (a Workers runtime per file), and the design-system Storybook stories (Chromium via Playwright) — so the `test` job is split into three:

- **`test-node`** — `packages` + `apps/web-worker` + the standalone sibling workers (`apps/bundle-worker`, `apps/convert-worker`, `apps/file-repair-worker`, `apps/edit-worker`, `apps/ocr-worker`, `apps/recovery-worker`, `apps/scan-worker` — default-pool unit tests with faked bindings) + `tooling`, with the `storybook` project excluded (`--project='!storybook'`), sharded within the job. No Miniflare, no browser: the bulk of the tests, cheapest per file.
- **`test-worker`** — the files under `apps/api-worker` + `apps/status-worker`, sharded within the job. The heaviest substrate (a Workers runtime per file), on its own so it scales independently.
- **`test-stories`** — the `storybook` project, one runner. The **only** browser suite, so it is the **only** job that installs Chromium — the split's biggest win over a blind shard, which paid the Playwright install on every shard.

Each job shards by file count (`--shard=i/N` over its scope; `SHARD_TOTAL` + the matrix list per job). **Completeness is by construction:** the three jobs partition every **registered** test file exactly once — `storybook` is the only project that spans a path root (it lives under `packages/design-system`), so it is the only one included-by-name in one job and excluded-by-name from another; every other file belongs to exactly one path root. Adding a new test area is **two registrations**: its vitest config into the root `vite.config.ts` `test.projects` list, **and** its path into `test-node` (or a new job). The path half fails loud when mis-scoped (vitest's `passWithNoTests` is left off — a path that matches nothing errors); the registry half is the one nothing catches automatically — `test.projects` is a closed list, and an unregistered project's tests run **nowhere** (root `vp test` and CI both walk only registered projects), so treat the registry as part of the partition. Wall-clock is now paced by the heaviest substrate rather than a random file draw; if `test-worker` becomes the pole, raise its shard count alone.
