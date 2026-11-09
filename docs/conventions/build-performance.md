# Build-time performance conventions

**Status:** Active (the playbook and the "apply it when you add something that builds" discipline apply now; concrete build-time budgets/metrics land later).

**Scope (single home for):** keeping **build time** fast — the developer feedback loop and everything that builds repeatedly in the cloud (Worker bundles, the SvelteKit SPA, Container images, Rust crates, generated artifacts). This is about how fast the build _runs_, not how fast the product runs at request time — that is runtime performance, which lives in [`performance.md`](performance.md) and golden rule 10.

**The build/deploy pipeline is Cloudflare Workers Builds**, not GitHub Actions — it builds and deploys each Worker on push to its **production branch, which for `magna-carta` and `magna-carta-web` has been `main` since 2026-08-29**: a merge to `main` deploys, within minutes, with no second gesture. The operator runbook (connect repo, build/deploy commands, branch control, enabling the settings below) lives in [`operations.md`](operations.md); this file is the principles and the why. **That move changed what the tiering below can assume** — several of its soundness arguments used to rest on a deliberate `git push origin main:release` standing between a merge and production, and no such gesture exists any more. Each of those arguments is corrected where it appears; none of them should be reused in its old form.

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
- **Respect the dependency graph; never build an artifact twice** — `vp run build-all` builds the SPA once and orders the Worker after it; do not add steps that rebuild the same output. **Ordering is a chain, not a list:** entries in one `dependsOn` array are siblings and run in parallel, so a step that must precede another belongs in the command chain (a nested `vp run` is inlined as its own task, and keeps its own cache entry) or behind that other step's own `dependsOn`. Listing the wasm build beside the SPA build ordered neither, and the deploy went red the day the SPA started importing wasm.
- **Ask for the artefact you need, not the set it belongs to** — `rust-wasm-build` is a chain of three per-crate tasks precisely so `magna-carta-web`, which rebuilds on every interface merge and imports pdf-core alone, compiles one crate rather than three. A task that bundles several slow, independently useful outputs should be decomposable by its callers.

### Move slow inputs to build time, not run time

Work that would otherwise happen on every cold start belongs in the image, fetched and pre-processed once at build time: baked databases, compiled/serialized rule blobs, prebuilt indexes. The scan Container is the worked example — it bakes the ClamAV signature DB and a compiled YARA-rule blob at build time, so the runtime container neither downloads nor recompiles them. This trades a slightly longer build for a fast, network-free start; prefer it whenever a runtime input is large and slow-changing.

### A Worker entrypoint spends a validated startup budget — keep it thin

Cloudflare validates every Worker deploy against a startup CPU budget covering all module-scope
work (error 10021, "Script startup exceeded CPU time limit"), and a deploy that exceeds it is
REFUSED — with `main` as production, that means merges stop reaching users until someone notices.
The app worker crossed the budget on 2026-08-31: its entrypoint statically imported the whole
route/consumer/sweep graph, and every route module builds its zod schemas and OpenAPI metadata at
module scope, so the aggregate finally outgrew the budget as routes accumulated.

The standing shape, worked in `apps/api-worker/src/index.ts` + `src/event-dispatch.ts`:

- **The entrypoint keeps only what must be synchronous at startup** — the Durable Object class
  re-exports the runtime instantiates by name. Nothing else is statically imported.
- **Everything that runs on an event** (the Hono app, the Cron pass router, the queue router, and
  their whole import graph) lives behind ONE dynamic `import()`, which the runtime evaluates on
  the first event instead of at validation. The dynamic import is cached per isolate, so the cost
  is paid once per cold start, off the validated budget.
- **Measure before shipping an entrypoint change:** `pnpm --filter @magna-carta/api-worker exec
  wrangler check startup` writes a local CPU profile and total. The split took the app worker from
  roughly 1.5 s to 0.24 s of local startup work. Local CPU is not Cloudflare CPU; treat the number
  as a trend, not the deployed truth.

The same rule binds every worker in the fleet: a new consumer, sweep, or route joins the
event-dispatch graph, never the entrypoint's static imports.

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
It is exhaustive and slow by design, and it is the whole-repo half of the **gate of record —
`pnpm gate`** ([`tooling/gate/`](../../tooling/gate/index.mjs), which runs it alongside the full
`pnpm test`, the dependency audit and the contract-drift checks) before a merge, not on the inner loop.
_The gate — `pnpm gate`, on the machine that made the change_ below is its home.

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
three seconds. It also runs **unconditionally** in the whole-repo `pnpm check` and in `pnpm gate`'s
`governance` dimension, next to the migration-integrity check: drift there is silent, survives a merge, and only
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
in `pnpm gate`, which runs before the merge into `main`.

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
(`pnpm check` plus the hosted gate of the time), and that tier is exactly the one that can be unavailable:
GitHub Actions started no job for eleven days under a billing block, and `pnpm check` was OOM-killed at
step one until its order was fixed. A gate you rely on being run by somebody else is not a gate — which
is also, one level up, why the gate of record is now a command rather than a workflow.

So `pnpm check:scoped` runs the repo-wide set itself, as two clearly-labelled steps:

| Step                        | When                                             | Measured cost                                 |
| --------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `repo-wide lints`           | **always**, whatever the diff                    | ~0.7 s (twelve scans, run concurrently)       |
| `repo-wide fitness sweep`   | any first-party source under `apps/`/`packages/` | ~2.1 s (thirteen Vitest scans in one process) |
| ... plus the `schema` scope | a `packages/database/` change                    | ~+0.5 s (thirteen more)                       |

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
set, so the inner loop runs it exactly when a manifest or lockfile moves. `lint:test-collection` is tens of
seconds (a list-only Vitest collection over ~70 projects), an order of magnitude past the inner loop's
budget, and only a project registration can move what it measures; its home is the gate's own
`test-collection` dimension. `apps/api-worker`'s route-conformance suite is 26 s as well — it runs in the
Miniflare pool, which costs far more to start than the assertions are worth here — so it stays in the
gate's test battery. An honest exclusion with a number beats a gate people disable.

**Membership derives itself; there is no roster.** A hand-maintained list of repo-wide checks is the same
bug one level up — the next one somebody writes will not be on it, and nothing will say so. So:

- The **lints** are enumerated from the `lint:*` scripts in the root `package.json`. Adding
  `"lint:whatever"` there puts it in the inner loop and in `pnpm gate`'s `governance` dimension (which
  calls the same runner with `--all`), with no other edit anywhere.
- The **fitness tests** self-register with a directive comment in their own header:
  `// @repo-wide-fitness — <why the diff can't reach it>`, or `scope=schema` for one whose only input is
  the Drizzle schema. The check declares its own jurisdiction in the file a reader is already looking at.

**And the governance lints have a governance lint.** [`pnpm run lint:lints`](../../tooling/lint-lints/)
holds four properties over the derived set itself: every `lint:*` script can actually fail (it has a
fixture test beside it, or a self-test that runs on every invocation), every one is named somewhere a
reader can find it, every lint command the conventions cite still resolves to a real script, and the
gate's `MAGNA_CARTA_FITNESS_SCOPES` (spelled as a literal in `tooling/gate/governance.mjs`, on purpose)
stays identical to `FITNESS_SCOPES_ENV` in `repo-wide.mjs` — a rename there would leave the sweep on
its default scope, covering less than the step claims, and say nothing. The first property is the one with debt: 23 of the 36 lints can fail today, and the other 13
are carried on a register in `tooling/lint-lints/rules.mjs` that may only shrink. The argument is the
one `lint-control-characters.mjs` makes about invisible bytes, one level up — a check that never fires
is indistinguishable from a clean tree, and that hazard applies hardest to the checks nothing checks.

**Both halves run in the gate — and for a long time only one did.** The hosted gate's `governance`
job called the lint runner with `--all` and stopped there; nothing ran the fitness sweep. Its
twenty-six members do each run under their own package's Vitest project, but that gate ran the test
battery only when asked, so the encryption chokepoint scan, the telemetry console ban, the off-token
and `bits-ui` boundary scans and the schema conformance checks were routinely reported for the first
time after the merge — the most expensive place to learn it. The sweep is now a step of its own in
`governance`, both scopes, unconditional: it is ~4 s there, which is less than deciding whether to run
it would be worth. The derivation is what makes this maintainable — neither half has a roster — but a
derived set still has to be CALLED, and this one was half-called for as long as it existed.

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
`pnpm gate` runs its test battery through the same guard, so a gate started while a suite is running in
the same worktree is refused rather than wedged.

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
a multi-path invocation is exposed to, and why the count needs an independent check
(`tooling/lint-test-collection/`) rather than a reading.

Two rules follow:

- **Filter with absolute paths.** An absolute filter takes a different branch entirely — a prefix test
  against the file's absolute path — so `"$PWD/packages"` selects every package's tests, which is what a
  reader expects the relative form to do.

  **`pnpm test` now does this for you**, so the relative form is no longer the broken one: a positional
  filter naming a directory in the repository is resolved to its absolute path before the runner sees it
  (`tooling/test-single-flight/path-filters.mjs`), which is why `pnpm test tooling` collects all 35 of
  that directory's files. Anything that is not a directory here — `select.test.mjs`, an option's value —
  is passed through untouched, because a token the wrapper cannot identify is one it has no business
  rewriting.

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
(`tooling/lint-test-collection/`) runs the unfiltered whole-suite collection in list-only mode and
asserts that it clears a **committed floor** — a project that stopped resolving, or an include glob
that started matching nothing, makes the suite smaller, faster and greener, and nothing else fails on
the absence. The floor and its update procedure live in `index.mjs`, next to the number; the
assertion lives in `collection.mjs` and is driven from constructed inputs by `collection.test.mjs`, so
it is shown to bite rather than merely to exist. It runs locally on demand and as the gate's
`test-collection` dimension. (While the suite was split across hosted runners the same lint also
proved the split was a partition — the union of the jobs equal to the whole and no file paid for
twice; `pnpm gate` runs the suite whole, so that arithmetic went with the split.)

**What it proves stops at collection.** `vp test list` resolves configs and globs files; it never
executes one, so this lint answers "which files would run", not "which files ran". The step between
them holds — measured directly at 949 registered files, every collected file executed and reported,
with nothing dropped.

**Reading a run's file count: take the number in parentheses, not the one before it.** The summary
line is `Test Files <per-state counts> (<collected>)`, and the two differ whenever a collected file
produces no result — a worker that died, a browser project whose browser is not installed, a run cut
short. A local run that omitted `--project='!storybook'` on a machine without Chromium printed
`Test Files 2 failed | 684 passed (695)`: nine files collected, dispatched, and never heard from, all
of them inside the parenthetical and none of them in either state count. Comparing the `passed`
number against a collected figure therefore manufactures a shortfall out of a run that dropped
nothing, and the same subtraction is what makes a genuine drop invisible.

**Reproduce a count with the unfiltered whole-suite run, never with a hand-typed path list.** A list
of positional paths that stops short does not fail — it runs a subset and reports a confident green,
the same property that made the original mis-scoped filter invisible. When the suite was split across
hosted runners, a fourteen-path invocation copied ten paths long printed `Test Files 649 passed (649)`
against the lint's 656 and read as a seven-file coverage hole in the gate, when it was seven paths
missing from the command; that mistake cost two separate investigations. One more trap for anyone
sharding a run by hand: `--shard=i/N` is applied inside the runner's pool, after the point `list`
stops, so a sharded collection cannot be listed, and a count taken from one shard is that shard's
count, not the run's.

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
the gate, and `pnpm test` never noticed because Vitest strips types rather than checking them. The
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

## The gate — `pnpm gate`, on the machine that made the change

**`pnpm gate`** ([`tooling/gate/index.mjs`](../../tooling/gate/index.mjs)) is the gate of record and
the merge bar. It runs every check the change can reach, from one command, on the worktree that holds
the change, and prints a summary a pull request pastes into its _Verification_ section. There is no
hosted check between a pull request and its merge, and by design nothing in the repository's
verification depends on a runner.

**Why it left the runner (2026-09-16).** From 2026-07-13 the same checks ran as a GitHub Actions
workflow, required on every pull request into `main` through the aggregate `gate` status. The
account's Actions minutes ran out on 2026-08-05; the workflow started no job for a month, ran again
from 2026-09-01, and stopped again on 2026-09-03. A required status that never reports blocks the
merge exactly as a red build would, so every pull request in those windows wedged behind a check that
had not run and merged on an administrator override — the gate failed closed on the budget and open
on the code, which is the opposite of what a gate is for. A gate that depends on somebody else's
budget is not a gate (the repo-wide tier above learned the same lesson one level down). So the
workflow is gone and the checks are not: the same dimensions, the same commands and the same
classification of the change, run here.

**One repository setting goes with it, and only the owner can change it:** the `main` ruleset's
_Require status checks to pass_ must no longer name `gate`. Until it is removed, GitHub keeps waiting
for a check nothing will ever report. That step is on the [deploy queue](../deploy-queue.md).

**The dimensions, in the order they run** — cheap and certain first, the battery last:

| Dimension         | Runs when                                | What it runs                                                                                                                                             |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`          | always                                   | `vp check --no-lint` over the whole repository, markdown included                                                                                        |
| `governance`      | always                                   | every `lint:*` script (derived), the repo-wide fitness sweep (both scopes), migration integrity, drizzle snapshot freshness                              |
| `audit`           | always                                   | osv-scanner over `pnpm-lock.yaml` and every first-party `Cargo.lock`; HIGH and above fail; `osv-scanner.toml` holds the accepted advisories              |
| `wasm`            | code changed                             | `vp run bootstrap` — the Rust->WASM artefacts, rebuilt only when stale                                                                                   |
| `typecheck`       | code changed                             | `tsc -b` over both root solutions, the reference-graph guard, the api-client type-check, svelte-check for the SPA and the design system                  |
| `contracts`       | code changed                             | the OpenAPI snapshot, the generated client and the design tokens, each regenerated and diffed against what is committed, plus the Spectral lint          |
| `lint`            | code changed                             | `vp check --no-fmt` over the affected packages and their full dependent closure (below); the whole repository when a global input moved                  |
| `rust`            | a crate or `rust-toolchain.toml` changed | `vp run rust-check`: cargo fmt, clippy `-D warnings` and cargo test over the crates workspace                                                            |
| `containers`      | a container changed                      | cargo fmt, clippy and test per changed container workspace, then its acceptance suite under Docker (`tooling/gate/classify.mjs` maps container to suite) |
| `test-collection` | code changed                             | `pnpm run lint:test-collection` — the whole-suite collection clears its floor                                                                            |
| `tests`           | code changed                             | the full `pnpm test`, under the single-flight lock — the node, Miniflare and Chromium suites together                                                    |

"Code changed" is the path classification the hosted gate used: documentation and the rendered
trackers (`docs/**`, `changelog.d/**`, `status.d/**`, `roadmap.d/**`, every `*.md`, and `STATUS.json`)
are non-code, because nothing reads any of them at build or test time, so a docs-only change runs
`format`, `governance` and `audit` and nothing else. `STATUS.json` is named specifically: it is not
markdown, and a markdown-only exclusion once classified the per-merge docs-assembly commit as a code
change and booted the whole battery. A file with a source extension counts wherever it lives.

**What it prints, and what the words mean.** Every dimension ends `passed`, `FAILED`, `skipped` (with
the reason: no input, or a flag) or `NOT RUN`. `NOT RUN` is the audit's word for "the pinned scanner
could not be fetched" — offline, or a platform without a pinned binary — and it is not a pass: the
gate exits 0 so an offline machine is not blocked on a network it does not have, the summary says so,
and the pull request says so. A gate that quietly checks nothing is worse than a slow one, so nothing
here is skipped silently. A dimension that fails does not stop the rest, because the summary is more
useful complete; the one dependency is `wasm`, whose consumers are reported as skipped when the
artefacts could not be built rather than failing on a dozen missing-module errors.

**The change** is everything since the merge-base with the trunk plus the working tree — the same set
`pnpm check:scoped` verifies, resolved the same way (the newest trunk merge-base; `--base <ref>`
overrides). An empty change, which is what a run on `main` itself is, runs everything at the widest
scope: that is the sweep, `pnpm gate --all` names it explicitly, and it is what to run after a batch of
merges lands. The other switches: `--plan` prints what would run and why, and runs nothing;
`--checks-only` drops the battery; `--only a,b` and `--skip a,b` name dimensions, and a name that is
not one is an error rather than a silent no-op. A dimension skipped by a flag is named in the summary,
so the pull request can say why.

**Every step runs under a time budget, and a step that exceeds it is its own outcome.**
A check that never returns is indistinguishable from a slow machine — no error, no exit code, no file
named — and that ambiguity is expensive out of all proportion to its causes. A single character in one
seventy-line source file (a raw U+FFFD in a used, `u`-flagged regex, which the linter's analysis never
terminates on) made the `lint` dimension unrunnable in September 2026. It was diagnosed five separate
times as container uptime, and the gate of record could not be run end to end for six days, while every
`pnpm check:scoped` in between passed — because the scoped check lints the diff and nothing had touched
that file since it landed. The character was a one-line fix; finding it was the whole cost.

So each step is given a budget ([`tooling/gate/budget.mjs`](../../tooling/gate/budget.mjs)), and one
that exceeds it is **killed and reported as `NO END`** — never folded into `FAILED`, because "found
problems" and "never finished" call for different next moves, and a dimension that did not finish
reached no verdict at all. The budgets are per **step** rather than per dimension (the step is what
hangs and what can be named) and are set well past the slowest honest run, because what they exist to
catch does not terminate at all — any finite budget detects it, and the only way the mechanism can do
harm is by firing on real work. `MAGNA_CARTA_GATE_TIMEOUT_SCALE=2` doubles them all and `=off` removes
them; a value it cannot parse is an error rather than a silent fallback to unscaled.

The teardown is the part worth not getting wrong. The gate never holds a handle on the process doing
the work — under `vp` sits the lint or test CLI, and under that the worker threads and the esbuild
services — so killing the direct child orphans the rest onto init, still holding the CPU and the caches
the next step wants. `spawnSync`'s own `timeout` does exactly that. Steps are therefore spawned to lead
their own process group and torn down through the same bounded terminate-wait-kill-confirm ladder the
test guard uses ([`tooling/test-single-flight/process-group.mjs`](../../tooling/test-single-flight/process-group.mjs)),
which does not return until the group is confirmed empty and says what it had to escalate to.

**What the runner gave, and what stands in for it.**

- _Parallel jobs._ The workflow fanned out to a dozen runners and finished in the time of its tallest
  dimension; here the dimensions run in series, so the wall-clock is the sum. The type-aware lint
  (below) and the test battery dominate it, and the classification is what keeps it proportionate: a
  few-package change lints in seconds, and a docs change runs in about a minute.
- _A status on the pull request._ Nothing on GitHub reports the gate now. The pull-request template
  asks for the summary block, and a merge to `main` is a deploy, so a pull request without one is a
  pull request whose verification is unknown.
- _The nightly sweep and the merge-time proof of the exact tree._ The sweep is `pnpm gate --all` after
  a batch of merges. The merge-time proof was never available (no merge queue for a user-owned
  repository; the [deploy queue](../deploy-queue.md) records the decision), so the habit stands: one
  merge at a time, the next branch synced onto the `main` the last one produced.
- _Seeded caches._ The WASM artefacts are `vp run bootstrap`'s, rebuilt only when stale and shared
  across worktrees through the cargo cache; there is nothing to seed. `containers/docker-build.sh`
  still takes `CONTAINER_BUILD_CACHE` for a hosted build that wants an external layer cache, and is a
  plain `docker build` when it is unset.

The one workflow left, [`assemble-docs.yml`](../../.github/workflows/assemble-docs.yml), still needs
Actions minutes and still folds fragments into the rendered trackers on every push to `main`; while
the budget is out it does not run, nothing waits on it, and the weekly docs-sync routine or a session
runs the same assemblers by hand ([`docs/maintenance/README.md`](../maintenance/README.md)).

## To formalize (later)

- Build-time budgets and a signal that flags a regression in build wall-clock, once there is a baseline worth holding.
- Persisting BuildKit **cache mounts** across Workers Builds runs (the registry/`target` mounts are build-local today) if cold Rust dependency compiles in the Container build become the bottleneck.
- **`tsgo` cutover** — swap the type-check engine to the TypeScript 7 native compiler once references have landed and it reaches GA, keeping a pinned JavaScript `typescript` for the Compiler-API tooling.
- **Break the app worker's direct dependence on nearly every foundational package.** The type-aware lint's cost is dominated by one package: building `apps/api-worker`'s whole-program type graph. Because the worker depends _directly_ on 39 of the 61 workspace packages, any change to one of them puts the worker in the affected set no matter how the dependent walk is bounded — a one-hop walk from `@magna-carta/identifiers` still covers 21 of the 24 packages the full closure covers. **Scoping is exhausted as a lever, measured in both directions** (2026-08-05): at package granularity by the fan-out above, and at _file_ granularity too — a reverse-import closure over the repository's own module graph still reaches 70–80% of the worker's 394 files for 37 of its 38 package dependencies, because `apps/api-worker/src/app.ts` mounts every route and 157 files import it. So the remaining structural fix is the dependency shape itself: `--defer-fanout-sinks` below moves the cost to a cheaper pass, it does not remove it.

### Scope the gate's type-aware lint to the affected packages (now)

The whole-repo type-aware lint (`vp check --no-fmt`, oxlint + tsgolint) is the gate's tall pole — **~45 min** on a 4-core/16 GB machine (0 errors, ~820 advisory warnings over ~1850 files, measured 2026-08-04), single-threaded, no cross-run cache upstream. It was ~24 min when this section was first written; the figure tracks the package count, so re-measure it rather than trusting the number here. But tsgolint builds its type program **lazily from the passed files' import closure**, so `vp check --no-fmt <paths>` scopes the cost to those paths: one small package is ~2 s where the whole repo is ~45 min (measured). The earlier belief that this "depends on a vp mechanism to scope `typeAware`" was wrong — the `vp check [PATHS]` passthrough already is that mechanism, and cross-package types still resolve from the closure.

So the gate's **`lint` dimension lints only the affected packages**, computed by `tooling/affected-lint`: the changed workspace packages **plus their dependents** — never just the changed files, because a type-aware finding in an unchanged file can flip when a dependency changes (that soundness gap is exactly why `check-scoped`, which lints only changed files, is fine for the local loop but not a merge gate). The walk is **unbounded** (the full transitive closure, `--max-hops all` on the command line), and `pnpm gate` defers nothing from it — the fan-out sink deferral below is the cheaper pass, not the gate's. A change to a global input — the lint ruleset and the shared compiler options (`vite.config.ts` — which is both the lint ruleset home and where `typeAware` lives — plus `tsconfig.base.json`, `packages/tsconfig/`), the lockfile, or the affected-lint logic itself — falls back to a whole-repo lint, as does any lintable source file outside every package (which is what still re-lints the whole repo for a script under `tooling/` or `.github/`). A workflow or action **YAML** change is deliberately **not** a trigger — it cannot move a type-aware lint result, so it does not pay the whole-repo pass. Only the lint dimension is scoped this way; type-check, tests, and the contract checks still run whole-repo, so the blast radius of a scoping miss is one type-aware lint rule, not correctness at large. A typical few-package change drops the tall pole from ~45 min to seconds; a foundational package (e.g. `@magna-carta/identifiers`) correctly re-lints its whole dependent set.

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
is "linting this package is effectively a whole-repo lint", which is proportional. With
`--defer-fanout-sinks` the classifier drops the sinks from the scope **when they are in scope only as
a dependent**; without it — which is how `pnpm gate` calls it — nothing is deferred. A sink the
change itself touched is never deferred.

**Who defers, and why the gate does not.** The hosted gate deferred the sinks on every pull request
to save runner minutes and linted them on the push that merged, so the union of the two passes covered
the closure; that was a move rather than a hole only because the second pass was guaranteed to run.
`pnpm gate` has no bill to save and no second pass, so it lints the closure whole: a change that
reaches `apps/api-worker` as a dependent pays the sink's lint on the branch, before the merge, which
is the honest price of a type-aware lint over this dependency shape. The flag stays for the pass that
cannot afford it — a quick `vp check --no-fmt $(node tooling/affected-lint/index.mjs --base origin/main --defer-fanout-sinks)`
while iterating — and the merge bar is the undeferred one. Two invariants keep the deferred pass
sound for whoever runs it, and
[`scope-fitness.mjs`](../../tooling/affected-lint/scope-fitness.mjs) (`pnpm run lint:affected-scope`,
in the gate's `governance` dimension) asserts both for a simulated change to **every** workspace
package: the deferred scope always contains the changed package itself, and the union of the deferred
scope and the undeferred scope always contains the package's full transitive dependent closure. It
derives that closure by an **independent fixpoint** over the same package graph the classifier reads —
a different algorithm on one source of truth, so a mistake shows up as a disagreement instead of as
two copies of itself. It also fails if the sink rule ever stops selecting an outlier: no sink at all
(the flag would be a silent no-op) or more than two sinks.

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

### The test suite runs whole in the gate (now)

The tests are deliberately **not** affected-scoped — a change in a foundational package can break a consumer's test that a dependency-graph scope would miss, and a missed test failure is a correctness hole, not (as with lint) one type-aware rule. `pnpm gate` runs the whole registered suite in one `pnpm test`, under the single-flight lock. Its three substrates still differ in what they need — plain node units (milliseconds), the Miniflare Workers pool (a Workers runtime per file, the heaviest per file), and the design-system Storybook stories, which are the only browser suite and need Chromium (`pnpm --filter @magna-carta/design-system exec playwright install chromium`); on a machine without the browser those files are collected and never heard from, which _Reading a run's file count_ above explains how to read. Adding a new test area is **one registration**: its vitest config into the root `vite.config.ts` `test.projects` list, a closed list — an unregistered project's tests run **nowhere** and nothing fails on their absence. `pnpm run lint:test-registration` holds that every config on disk is registered, and `pnpm run lint:test-collection` holds that the registered suite still collects at least its floor. When the suite was split across hosted runners it was sharded along those substrates, so the browser install was paid once and the heaviest pool scaled on its own; the split, and the partition proof that went with it, left with the runner.
