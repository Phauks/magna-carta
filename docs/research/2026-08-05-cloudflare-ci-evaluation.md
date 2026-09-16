# Running CI on Cloudflare instead of GitHub Actions — Evaluation

**Date:** 2026-08-05
**Scope:** Whether the whole-repo quality gate (`.github/workflows/gate.yml` as it stood on this date; the workflow was removed on 2026-09-16 in favour of the local `pnpm gate`, `tooling/gate/`) can move off GitHub Actions and onto Cloudflare — Workers Builds specifically, plus every other CI-shaped thing Cloudflare sells — and what that would cost and take.
**Prompted by:** the owner's GitHub Actions minutes reaching their budget limit (CI austerity active as of 2026-08-05; merges temporarily backed by local verification), plus an owner-supplied Reddit link.
**Purpose:** This is **research, not a spec and not a decision.** Nothing here is built or committed. The binding decision in this area is **ADR-0075 as amended** — Cloudflare Workers Builds is the build-and-deploy pipeline — and nothing in this document changes it. Items labelled a recommendation are recommendations only; items labelled owner-decision are requests for one.

> **Superseded in one premise, 2026-08-29.** This document reasons throughout from a deploy that is a separate deliberate act (`git push origin main:release`). The owner has since moved `magna-carta` and `magna-carta-web` onto `main`, so **a merge to `main` deploys within minutes**. The evaluation's conclusion is unaffected — it turns on price per minute and on what Workers Builds can run, not on which branch triggers it — but its framing of the deploy is stale wherever it appears below. The live branch model is in [`operations.md`](../conventions/operations.md) under _Cloudflare Workers Builds_. The change also sharpens §1's recommendation: with the merge and the deploy now one event, an unblocked pull-request gate is the only thing standing between a defect and production.

---

## 1. Summary — the recommendation, stated plainly

**Recommendation: do not move the gate to Cloudflare. Attack the lint bill instead.** The migration is technically possible for about half the gate, it is not possible at all for the most expensive half, and — this is the part that decides it — **it would not have prevented the budget overrun**, because Cloudflare's rate is only about 17% below GitHub's and the overrun is one to two orders of magnitude past the included tier on either platform.

Three findings carry that conclusion.

**First, the cost gap is not where the question assumes it is.** Workers Builds includes 6,000 build minutes a month against GitHub Free's 2,000, and charges $0.005 a minute against GitHub's $0.006 for a Linux 2-core runner. That is 4,000 extra included minutes (worth about $24 a month) and a 17% rate cut. Measured against this repository's actual volume — see section 7 — the gate consumes somewhere between 23,000 and 112,000 billable minutes a month. Against numbers of that size, a 17% rate cut is a rounding error. **Moving platforms changes the bill by roughly a quarter; changing what the gate does changes it by roughly two-thirds.**

**Second, one job is 43% of the bill.** On a measured, real pull-request run (17 jobs, 2026-08-05), the type-aware `lint` job took **25 minutes 57 seconds** against a total of ~60 billable minutes for the entire run. That is the affected-packages, **one-hop** tier — the cheap one. The whole-repo tier is ~45 minutes and is currently suspended. [`build-performance.md`](../conventions/build-performance.md) already names the root cause and the fix: `apps/worker` depends directly on nearly every foundational package, so any foundational change drags the worker's whole-program type graph into scope no matter how the dependent walk is bounded. **The dependency shape is the CI bill.** No platform change touches it.

**Third, the gate's most expensive job is the one Workers Builds structurally cannot run.** Workers Builds imposes a hard **20-minute build timeout** and **8 GB of memory**. The lint job measured 26 minutes and needs `GOMEMLIMIT=10GiB` to avoid an out-of-memory abort on a 16 GB runner. It fails both limits, not marginally but by a factor. So a migration would move the cheap jobs and strand the expensive one on GitHub — which is the opposite of the intended saving.

**One genuine surprise, in Cloudflare's favour, worth recording even though it does not change the answer.** The Workers Builds documentation never mentions Docker, and the natural inference is that the build image has none. **That inference is wrong, and this repository is the proof.** [`vite.config.ts`](../../vite.config.ts) builds three Rust→WASM artefacts by invoking `docker build` inside Workers Builds on every production deploy, and four Container images build there through `wrangler deploy`. The runner has a working Docker daemon, with one documented quirk (`--network=host`, because the runner's Docker isolates RUN-step networking). Section 4.3 sets this out. It means the `wasm`, `rust`, and `containers` jobs are _not_ blocked on tooling — they are blocked on time, disk, and the absence of a fan-out model.

**What to do instead, in order of value:** (1) break `apps/worker`'s direct dependence on the foundational packages, which is the fix `build-performance.md` already identifies and which is worth more than the entire migration; (2) move the cheap, single-threaded jobs to GitHub's **$0.002/minute Linux 1-core** runner, a 3× rate cut available today with a one-line change per job and no platform migration at all; (3) keep the deploy pipeline exactly where it is. Section 8 sizes all three.

---

## 2. Could not read the linked thread

The owner supplied a Reddit link. **It could not be read, and no attempt will succeed from here.** Reddit hard-blocks server-side fetching: requests from a datacentre address return HTTP 403 from Reddit's edge, `old.reddit.com` behaves identically, and a `/s/` share slug never resolves to a thread ID without executing that request, so the thread cannot be identified by ID or located by content either. This is the same wall the [Cloudflare Agents assessment](2026-08-04-cloudflare-agents-assessment.md) hit on 2026-08-04 with a different Reddit link; it is a standing property of the source, not a transient failure.

**Everything in this document is therefore from primary sources — Cloudflare's own documentation, GitHub's own billing documentation, and this repository's measured CI data — and none of it is the thread the owner pointed at.** If the thread matters, its text or a resolved permalink is needed. Practically: it is likely to be either an enthusiastic "Workers Builds replaced my CI" post or a complaint about its limits, and section 4 covers both possibilities from the documentation, so the loss is probably small. But it is a real gap and is recorded as one.

---

## 3. What we already have (so the question is narrower than it looks)

Worth stating before evaluating anything, because it changes what "move CI to Cloudflare" would even mean: **the deploy pipeline is already on Cloudflare.** Per [`operations.md`](../conventions/operations.md), seven Workers are connected to the GitHub repository through Workers Builds, each building and deploying on a push to its production branch — which is **`release`, not `main`**. A push or merge to `main` deploys nothing; a deploy is the deliberate `git push origin main:release`.

> _Two facts in that paragraph have since been corrected, and neither changes this document's answer: the connected count is **twelve**, not seven (API-verified 2026-08-24), and `magna-carta` and `magna-carta-web` build from **`main`** as of 2026-08-29, so a merge deploys. What stands is the sentence the section exists for — the CD half is already on Cloudflare, so the question is only about the CI half._

So the question is not "should we use Cloudflare for CI/CD" — we do, for the CD half. The question is precisely: **can the CI half — the quality gate — move there too?** That is a narrower and more answerable question, and it has a cleaner answer, because Workers Builds is built for the CD half and shows it.

---

## 4. Workers Builds — what the primary sources say

Crawled page by page from [`developers.cloudflare.com/workers/ci-cd/`](https://developers.cloudflare.com/workers/ci-cd/), both halves of the tree, on 2026-08-05.

### 4.1 The shape of the product

The CI/CD overview names exactly three options: **Workers Builds**, **GitHub Actions**, and **GitLab CI/CD**. It frames the choice on one axis only — where your Git repository is hosted. Workers Builds is for "a fully integrated solution within Cloudflare's ecosystem that requires minimal setup" on cloud-hosted GitHub or GitLab; external providers are for "a self-hosted instance" or "a Git provider that is not GitHub or GitLab."

**Note what that framing does not contain: any axis about what the pipeline needs to do.** Cloudflare does not position Workers Builds as a general CI runner, and the product's shape follows from that. A Workers Build is: clone the repository, run one optional **build command**, run one **deploy command** (default `npx wrangler deploy`). That is the whole model. There is no job graph, no matrix, no fan-out, no artefact passing between builds, no conditional step, no aggregate status. Every structural feature the gate is built out of is absent.

The one documented way to build without deploying is to set the deploy command to `npx wrangler versions upload`, which uploads a version without promoting it — that is the default **non-production branch deploy command**, not a general "run checks only" mode.

### 4.2 Limits and pricing — the numbers that decide it

From [Limits & pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/):

| Limit                     | Free                                   | Paid (we are here)                         |
| ------------------------- | -------------------------------------- | ------------------------------------------ |
| **Build minutes**         | 3,000 / month                          | **6,000 / month**, then **+$0.005/minute** |
| **Concurrent builds**     | 1                                      | **6**                                      |
| **Build timeout**         | **20 minutes**                         | **20 minutes**                             |
| **vCPU**                  | 2                                      | 4                                          |
| **Memory**                | 8 GB                                   | **8 GB**                                   |
| **Disk**                  | 20 GB                                  | 20 GB                                      |
| **Environment variables** | 64 per Worker, 5 KB each               | same                                       |
| **Deploy hooks**          | 10/min per Worker, 100/min per account | same                                       |

Four of these are load-bearing against our gate and all four are bad news:

- **20-minute timeout.** Hard, both plans, and confirmed independently on the [troubleshooting page](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/): "There is a maximum build duration of 20 minutes. If a build exceeds this time, then the build will be terminated." Our `lint` job measured **26 minutes** at its _cheap_ tier and ~45 minutes at its whole-repo tier. Our `containers` job carries a 90-minute cap. Neither can run, at all, ever, under any configuration.
- **8 GB memory.** The `lint` job sets `GOMEMLIMIT=10GiB` specifically because tsgolint's Go runtime lets the heap overshoot to roughly twice the ~6 GB live type graph and aborts on a 16 GB runner without it. On 8 GB there is no limit value that both fits and leaves the collector room. This is a second, independent disqualification of the same job.
- **6 concurrent builds.** Account-wide, and seven Workers are already connected. The gate fans out to **17 jobs**. Even the feasible subset would queue behind itself and behind real deploys.
- **6,000 included minutes.** Three times GitHub Free's 2,000, which sounds decisive until section 7 puts it against measured volume.

### 4.3 The build image — and the Docker surprise

[The build image page](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) documents Ubuntu 24.04 on x86_64 with Node 24.18.0 (22.23.2 also present), pnpm 10.11.1, npm 10.9.2, yarn 4.9.1, Bun 1.2.15, Go 1.24.3, Python 3.13.3, Ruby 3.4.4, and an apt set including `build-essential`, `curl`, `git`, `git-lfs`, `libssl-dev` and similar. Versions are overridable by environment variable or version file (`.nvmrc`, `.python-version`).

**Rust is not on that list. Neither is Docker.** For Rust the omission is real: there is no `cargo` or `rustup` in the image, and a Rust job would have to `curl` rustup and install a toolchain on every build — several minutes against a 20-minute ceiling, with no cross-build cache to amortize it (section 4.4).

**For Docker the omission is a documentation gap, not a fact.** This repository proves the daemon is there, in production, twice over:

- [`vite.config.ts`](../../vite.config.ts) defines `rust-wasm-build` as three `docker build` invocations producing the pdf-core, decryption-core and email-core WASM artefacts, and its own comment records why: "this is the one canonical wasm build, invoked identically in local builds and in Cloudflare Workers Builds: the build environment needs only Docker (which the Workers Builds runner provides — the same way the scan/bundle/convert container images build), never Rust or wasm-pack on the bare machine." The `magna-carta` Worker's production build command runs `vp run build-all`, which depends on that task. It succeeds on every deploy.
- The same comment records a quirk found the hard way and worth carrying forward: **`--network=host` is required**, because "the Workers Builds runner's Docker isolates RUN-step networking (image pulls work, but RUN-step DNS fails)". A Dockerfile that downloads anything in a `RUN` step fails on the runner without it.
- Four connected Workers (`magna-carta-scan`, `-bundle`, `-recovery`, `-file-repair`) build and push full Container images through `wrangler deploy`, which the [Containers image-management docs](https://developers.cloudflare.com/containers/platform-details/image-management/) confirm requires a running Docker daemon: "Docker or a Docker-compatible CLI tool must be running for Wrangler to build and push images."

**So: Workers Builds has Docker, undocumented, and we depend on it.** That is worth recording independently of this evaluation — it is load-bearing for the deploy pipeline and it rests on an undocumented property, which means a Cloudflare change to the build image could break every deploy with no deprecation notice.

It also means the `wasm`, `rust`, and `containers` jobs are not blocked on _tooling_. They are blocked on the 20-minute ceiling, the 20 GB disk (the `containers` job already exhausted a GitHub runner's disk and needs an explicit cleanup step), and the absence of any way to express them as parallel jobs.

### 4.4 Caching — narrower than the gate needs

[Build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/) is enabled per Worker in Settings → Build → Build cache. It caches the **package-manager store** (`.pnpm-store` for pnpm) and, for a closed list of recognised frameworks, that framework's build directory (`.next/cache`, `node_modules/.astro`, and similar). Allocation is **10 GB per project**, evicted least-recently-read; artefacts are **purged 7 days after last read**, and unread ones 7 days after creation.

**Arbitrary directories cannot be cached.** That is the constraint that matters, because the gate's caching is almost entirely arbitrary directories:

| What the gate caches                   | Workers Builds equivalent                          |
| -------------------------------------- | -------------------------------------------------- |
| pnpm store                             | **Yes** — native, automatic                        |
| `packages/*/src/pkg` (WASM artefacts)  | **No** — would rebuild the Docker WASM every build |
| `*/.tsbuild` (TypeScript incremental)  | **No** — cold whole-program type-check every build |
| Playwright browser (`pw-browsers`)     | **No** — ~30 s Chromium install every build        |
| Cargo registry + target (`rust-cache`) | **No** — cold dependency compile every build       |
| buildx layers (`type=gha`)             | **No** — the backend is GitHub's cache service     |

The buildx row deserves a note: `type=gha` is a GitHub-specific backend. A Workers Builds port would need `type=registry` against a registry we run, which is possible but is new infrastructure, and [`build-performance.md`](../conventions/build-performance.md) already lists cache-mount export as a deferred item.

The net effect is that a Workers Builds port would pay cold what the gate currently gets warm, on jobs already close to the 20-minute ceiling. **The caching gap makes the timeout problem worse, not better.**

### 4.5 Triggers, branches, and the pull-request semantics gap

[Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/): the production branch is set per Worker under Settings → Build → Branch control, and a checkbox — **"Builds for non-production branches"** — turns on builds for every other branch. The documentation is explicit that "every push event made to a non-production branch will trigger a build."

Two consequences, both material:

- **Builds are push-triggered, not pull-request-triggered.** They build the **branch head**, not the merge result. Our gate's `pull_request` trigger builds the merge commit — the tree that will actually exist on `main` — and the whole soundness argument in [`build-performance.md`](../conventions/build-performance.md) for skipping the test battery on the push to `main` rests on up-to-date-before-merge, i.e. on having tested the real post-merge tree. Workers Builds cannot express that, and it has no `merge_group` equivalent, so the merge-queue path the gate is already wired for would be lost.
- **Turning it on means every push to every branch builds.** There is no path-or-branch predicate finer than watch paths. With several agent worktrees pushing concurrently, that is a large and largely wasted multiplier — and it competes for the 6 concurrent slots with real deploys.

Also, per [`operations.md`](../conventions/operations.md), Workers Builds "always builds regardless of paths when a push has 0 changes, 3000+ changes, or 20+ commits" — so watch paths are not a reliable cost cap either.

### 4.6 Gating a pull request on a Workers Build — the honest answer

This is the crux for using Workers Builds as a _gate_ rather than a _pipeline_, and the honest answer is: **partly yes mechanically, and no in a way you would want to rely on.**

What is documented: [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) says build status surfaces in GitHub as **check runs** and pull-request comments (GitLab gets commit statuses), so you can "manage deployments without leaving your workflow." [Advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/) repeats it for the monorepo case.

What is **not** documented anywhere in either the Workers or the Pages tree: **whether those check runs can serve as required status checks in branch protection.** The Pages [GitHub integration page](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) — the most detailed page Cloudflare has on the subject — describes check runs and where to see them and says nothing about branch protection. Search results that assert it works are inferring, not quoting; this document does not repeat that inference as fact.

Mechanically it should work, since GitHub matches required checks by name against any check run. But there is a **documented hazard that makes it actively unsafe here**, and it is quoted on that same page: _"If a build skips for any reason (i.e. CI Skip, build watch paths, or branch deployment controls), the check run/commit status will not appear."_

GitHub treats a required check that never reports as **permanently pending**, which blocks the pull request forever. Our gate is built on path filtering — a docs-only change deliberately skips almost every job — so under Workers Builds a docs-only pull request would produce no check run and wedge. This is precisely the failure mode [`operations.md`](../conventions/operations.md) already warns about for our own workflow ("Branch protection must require the aggregate `gate` job… requiring a job that a given diff skips would wedge the merge"), and the aggregate-`gate`-job trick that solves it on Actions **has no Workers Builds equivalent**, because there is no job that always runs and reports the roll-up.

**So the gating story is: undocumented, and structurally hazardous in exactly the configuration we use.** That alone would disqualify Workers Builds as the required check even if the timeout did not.

### 4.7 The other half of the tree — external CI/CD

The [GitHub Actions page](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) documents the alternative: [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action), authenticated with `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` stored as GitHub secrets, with the standard warning not to commit the token.

**This is the inverse of what the owner's question proposes**, and it is worth naming because it is the other end of the same axis: instead of moving checks onto Cloudflare, it moves deploys onto GitHub. **It is strictly worse for us and should not be adopted.** Three reasons:

1. It _adds_ GitHub Actions minutes for work Cloudflare currently does for free — the opposite of the goal.
2. It introduces a long-lived deploy-capable API token into GitHub secrets. Workers Builds needs none: as [`operations.md`](../conventions/operations.md) records, "there is **no `CLOUDFLARE_API_TOKEN` in GitHub**; the connection is managed entirely from the dashboard." Adopting wrangler-action would be a real reduction in the credential posture of a privileged system, traded for nothing.
3. It would break the scan Worker's Cloudflare-native nightly signature refresh, which POSTs a Workers Builds deploy hook on a cron with no GitHub involvement at all.

**The useful framing for the owner is therefore not "Cloudflare versus GitHub" but "which half runs where" — and the current split is already the right one.** Cloudflare runs the deploys, where its model fits and its minutes are free to us. GitHub runs the checks, where the fan-out DAG, matrix sharding, arbitrary caching, merge-commit semantics, and required-status aggregation all exist. Each platform is doing the half it is actually built for. The overrun is not evidence that the split is wrong; it is evidence that the _checks are too expensive_, which is a different problem with a different fix (section 8).

### 4.8 Any other Cloudflare CI-shaped offering

One, and it is a real one: **Cloudflare Sandboxes**. The [Sandbox docs](https://developers.cloudflare.com/sandbox/) describe isolated containers with "a full Linux environment," and — unusually — Cloudflare **explicitly names CI/CD as a first-class use case**: "Run tests, compile code, and execute build pipelines in isolated environments with parallel execution and streaming logs." Sandboxes and Containers reached GA on 2026-04-13, and a [2026-02-17 changelog entry](https://developers.cloudflare.com/changelog/post/2026-02-17-docker-in-docker/) added **Docker-in-Docker** to both — explicitly for "building images for CI/CD."

On paper this clears several Workers Builds blockers at once: no 20-minute ceiling, container sizes chosen by us rather than fixed at 8 GB, genuine parallelism, and Docker-in-Docker for the container acceptance suites.

**And it should still be refused, for now.** What Sandboxes gives is a _substrate_, not a CI system. Everything the gate gets from Actions above the substrate — trigger semantics, the job DAG, matrix sharding, caching, artefact passing, check-run reporting, required-status aggregation, log retention, re-run-failed-jobs — would have to be **written and then maintained by us**, in a repository whose actual constraint is engineering time. It is billed on Containers rates (memory GiB-s + vCPU-s + disk), which is a usage-metered line that is easy to underestimate and which nothing in [`operating-costs.md`](../operating-costs.md) currently models. And the reward for building a bespoke CI platform is, at best, the 17% rate cut from section 1.

**Recommendation: note Sandboxes, adopt nothing.** It is the right thing to reconsider if we ever need a self-hosted runner for a reason other than price — a GPU step, a very long job, an isolation requirement. Building one to save $0.001 a minute would be a poor trade.

---

## 5. Per-job feasibility — the gate mapped onto Workers Builds

Every job in `gate.yml` (as it stood on this date), with measured wall-clock from a real pull-request run (`30963909970`, 2026-08-05, 17 jobs, a broad change touching a foundational package). "Billable" is GitHub's per-job round-up to the whole minute.

| Job              | Measured                         | Billable | Feasible on Workers Builds?         | The binding constraint                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`        | 8 s                              | 1        | **No — not expressible**            | Its entire purpose is to emit outputs that gate other jobs. Workers Builds has no job graph and no outputs. Watch paths are the nearest analogue and are per-Worker, coarser, and bypassed on large pushes.                                                                                                                                                                                             |
| `format`         | 76 s                             | 2        | **Yes**                             | Pure `vp check --no-fmt` over the repo, no WASM, no browser. Fits comfortably. The cleanest migration candidate in the gate.                                                                                                                                                                                                                                                                            |
| `governance`     | 40 s                             | 1        | **Yes, with a caveat**              | Node lints plus one Vitest file. Downloads `osv-scanner` by pinned SHA256 — needs egress, which the runner has. Fits.                                                                                                                                                                                                                                                                                   |
| `contracts`      | 54 s                             | 1        | **Yes, but slower**                 | Needs the WASM artefacts. With no cross-build cache for them it must rebuild all three in Docker first (~7 min cold), so realistically ~8 min of a 20-minute budget for 54 s of work.                                                                                                                                                                                                                   |
| `typecheck`      | 126 s                            | 3        | **Yes, but much slower**            | Same WASM dependency, plus the `.tsbuild` incremental state is uncacheable — every build is a cold whole-program `tsc -b`. Cold is minutes, not the measured 126 s. Tight against 20 minutes, not over it.                                                                                                                                                                                              |
| `wasm`           | 14 s (cache hit)                 | 1        | **Runs, but pointless**             | Docker works (section 4.3), so the build itself is fine — but its whole job is to build once and **share the artefact to other jobs**, and Workers Builds has no artefact passing. Every consumer rebuilds.                                                                                                                                                                                             |
| `test-node` ×2   | 52 s, 47 s                       | 1, 1     | **Yes, unsharded**                  | Plain Node units. No matrix, so both shards collapse into one serial run. Cheap enough that this is fine.                                                                                                                                                                                                                                                                                               |
| `test-worker` ×4 | 246–267 s                        | 5,5,5,4  | **Probably — and this is the crux** | See section 6. `workerd` should run (it is an ordinary Linux binary, and Docker already runs there, which needs more privilege than `workerd` does), **but no Cloudflare source confirms it and we have not tested it.** Unsharded, the four shards serialize to ~17 min measured — inside 20 minutes with no margin, and that is _before_ the uncached WASM rebuild. **Effectively over the ceiling.** |
| `test-stories`   | 136 s                            | 3        | **Marginal**                        | Chromium via Playwright. Installable, but the ~30 s install is uncacheable and repeats every build. Would fit; wasteful.                                                                                                                                                                                                                                                                                |
| `lint`           | **1,557 s (25m57s)**             | **26**   | **No — hard fail, twice**           | **26 min measured at the cheap one-hop tier, ~45 min whole-repo, against a 20-minute ceiling.** Independently: needs `GOMEMLIMIT=10GiB` against 8 GB of machine. Two unrelated disqualifications.                                                                                                                                                                                                       |
| `rust`           | skipped                          | 0        | **No, in practice**                 | No Rust in the image; `rustup` install plus a cold `cargo` compile with no `rust-cache` equivalent, against 20 minutes. Would need a custom Docker image to be viable.                                                                                                                                                                                                                                  |
| `containers`     | skipped                          | 0        | **No**                              | Carries a 90-minute cap for a reason: seven Cargo workspaces, multi-gigabyte images, buildx `type=gha` layer cache. Against 20 minutes and 20 GB of disk, with no GitHub cache backend. Not close.                                                                                                                                                                                                      |
| `gate`           | 3 s                              | 1        | **No — not expressible**            | The aggregate required status. Nothing in Workers Builds can produce a roll-up that always reports (section 4.6). Its absence is what makes required-check gating unsafe.                                                                                                                                                                                                                               |
| **Total**        | **51.7 min raw / 26.9 min wall** | **~60**  | **5 of 13 cleanly**                 | Everything expensive is on the wrong side of the line.                                                                                                                                                                                                                                                                                                                                                  |

**Read the table by cost, not by count.** Five jobs port cleanly and they are worth **6 billable minutes of 60 — 10%**. The three that cannot port at all (`lint`, and the structurally inexpressible `changes` and `gate`) plus `test-worker` account for **47 of 60 — 78%**. A migration would move a tenth of the bill and leave nine-tenths where it is, while adding a second platform to maintain.

---

## 6. The crux: can `vitest-pool-workers` run inside Workers Builds?

The brief flags this as the deciding technical question, so it gets its own treatment — including the honest statement of what is not known.

**What is established.** `@cloudflare/vitest-pool-workers` runs tests inside `workerd` — Cloudflare's own runtime, distributed as a plain x86-64 Linux binary through npm and launched as a child process, with the Node host talking to it over WebSockets. It needs no Docker, no privileged capabilities, and no kernel features beyond what an ordinary Ubuntu container provides.

**The inference, and it is a strong one.** The Workers Builds image is Ubuntu 24.04 with Node 24 and pnpm, it runs `pnpm install` on our repository today, and — established in section 4.3 — it runs a **Docker daemon**, which requires substantially more privilege than spawning `workerd` does. An environment that can run Docker can run `workerd`. Combined with 4 vCPU and 8 GB, there is no plausible mechanism by which the pool fails to start.

**The honest caveats, both real.**

- **No Cloudflare source states it.** Nothing in the Workers Builds tree, the testing docs, or the `vitest-pool-workers` documentation says "you can run these tests in Workers Builds." The inference above is ours. It is well-founded and it is still an inference, and this document will not upgrade it to a fact. Confirming it costs about an hour (section 8, spike A).
- **There is a known CI reliability issue.** [`cloudflare/workers-sdk#10600`](https://github.com/cloudflare/workers-sdk/issues/10600) reports `vitest-pool-workers` timing out in `resolveId` specifically in containerised Linux CI. Workers Builds is a containerised Linux CI. That is not proof of failure, but it is the exact environment class where the pool is known to be flaky, and 190 worker test files is a large surface for an intermittent failure.

**And it does not matter, because the timing already fails.** Even granting that the pool runs perfectly: the four shards measured 246, 251, 267 and 227 seconds _in parallel_. Workers Builds has no matrix, so they serialize to **~17 minutes** — before the uncached WASM rebuild that must precede them (~7 min cold), before `pnpm install`, before the clone. That is **~25 minutes against a 20-minute ceiling.** The only escape is splitting the suite across four separately-connected Workers to recover parallelism, which is the anti-pattern section 7 prices.

**Conclusion: probably yes technically, decisively no practically.** The crux question resolves against the migration on timing regardless of how the technical question comes out, which is why spike A is worth an hour of curiosity and nothing more.

---

## 7. Cost comparison at measured volumes

### 7.1 The measured basis

One real pull-request gate run, `30963909970`, 2026-08-05, 17 jobs, success — a broad change (foundational package touched, so the 4-shard split and a wide lint scope):

- **Raw job time: 51.7 minutes.** **Wall-clock: 26.9 minutes** (paced entirely by `lint`). **Billable: ~60 minutes** after GitHub's per-job round-up.
- **`lint` alone: 26 billable minutes — 43% of the run.**

A narrow change (small lint scope, 2 worker shards) computes to **~26 billable minutes**, ~19.6 minutes raw. So a pull-request gate run costs **26–60 billable minutes** depending on blast radius.

**A note on the brief's "4–5 minute" figure:** that is _wall-clock latency for a small or docs-only change_, and it is accurate — the docs-only path runs `format` + `governance` only, ~2 minutes. It is not the billable cost of a code change, which is the number that consumed the budget. **The gap between "the gate feels fast" and "the gate is expensive" is the fan-out: 17 jobs billed independently, wall-clock paced by one.** That gap is the whole story of the overrun.

An unrelated but useful observation from the same data: **`billable.UBUNTU.total_ms` reads `0` for every job** in the Actions API. Whatever that reflects, per-minute attribution should be read off the billing page rather than the API, and the figures below are computed from measured durations, not from GitHub's own billing numbers.

### 7.2 Monthly cost, both platforms

Peak day is 62 merges; a plausible sustained average is lower. Both are shown. GitHub Free includes 2,000 minutes/month for private repositories at **$0.006/min** (Linux 2-core, post-January-2026 pricing); Workers Builds Paid includes 6,000 at **$0.005/min** — and we already pay the $5 Workers Paid floor for unrelated reasons, so its included tier is genuinely free to us.

| Scenario                      | Billable min/month | GitHub Actions overage | Workers Builds overage | Difference |
| ----------------------------- | ------------------ | ---------------------- | ---------------------- | ---------- |
| Narrow changes, 30 merges/day | 23,400             | **$128**               | $87                    | −$41       |
| Narrow changes, 62 merges/day | 48,360             | **$278**               | $212                   | −$66       |
| Broad changes, 30 merges/day  | 54,000             | **$312**               | $240                   | −$72       |
| Broad changes, 62 merges/day  | 111,600            | **$658**               | $528                   | −$130      |

**Read the last column.** A _complete, frictionless, hypothetical_ migration of the entire gate saves **$41–130 a month**. And it is hypothetical in the strict sense: sections 4 and 5 establish that the whole gate cannot move, so the achievable saving is the feasible subset — **10% of the bill**, or roughly **$13–66 a month** — in exchange for maintaining two CI platforms, losing merge-commit semantics, losing the required-status aggregation, and rebuilding six caches.

Three further corrections all push the real Cloudflare number _up_, not down:

- **No fan-out means no parallelism, and Workers Builds bills wall-clock per build.** Splitting across separately-connected Workers to recover parallelism means each pays its own clone and `pnpm install` — roughly 1–2 minutes of pure overhead per split, times the number of splits, times every run.
- **The caching gap is a permanent surcharge.** Cold WASM (~7 min), cold `tsc -b`, cold Playwright, cold Cargo — on every build, forever.
- **6 concurrent builds, account-wide, shared with real deploys.** At 62 merges a day the queue is the constraint, and queueing on the deploy path is a new operational risk we do not have today.

**The conclusion the table forces: platform choice is not the lever.** At these volumes the difference between the two vendors is 17%; the difference between running `lint` and not running it is 43%.

### 7.3 The lever that is actually large

Three levers, priced against the same measured run:

| Lever                                                                | Effect on the bill        | Cost to do it                              |
| -------------------------------------------------------------------- | ------------------------- | ------------------------------------------ |
| **Move the whole gate to Workers Builds** (impossible as shown)      | −17% best case, −10% real | Weeks, plus a permanent second platform    |
| **Move cheap single-threaded jobs to Linux 1-core ($0.002/min)**     | **−67% on those jobs**    | **One line per job. No migration at all.** |
| **Break `apps/worker`'s direct dependence on foundational packages** | **−43% of a broad run**   | A real refactor, already on the roadmap    |

The middle row is the finding most likely to be actionable this week and it comes from GitHub's own pricing, not Cloudflare's: **Linux 1-core (x64) is $0.002/minute against 2-core's $0.006** — a **3× rate cut**. `format`, `governance`, `contracts`, `changes`, and `gate` are short and not meaningfully parallel; `test-node` is milliseconds per file. Moving those to a 1-core runner is a `runs-on:` change with no architectural consequence, and it beats the entire Cloudflare migration on both saving and effort. (`lint`, `typecheck`, and `test-worker` want the cores and should stay.)

The bottom row is the one that actually ends the problem, and [`build-performance.md`](../conventions/build-performance.md) already carries it under _To formalize_: "a one-hop walk from `@magna-carta/identifiers` still covers 21 of the 24 packages the full closure covers… the remaining structural fix is the dependency shape itself." **That was written as a build-latency item. The measured data reclassifies it as the single largest line in the CI bill.**

---

## 8. Migration effort, if it were pursued anyway

Sized honestly, so the number is available if the owner wants it despite the recommendation.

**Hybrid — TypeScript suites on Cloudflare, Rust and containers on GitHub at reduced cadence (the brief's proposal): 3–5 days, and it does not achieve its goal.** The suites that would move are `format`, `governance`, `test-node`, and possibly `test-stories` — **6 of 60 billable minutes**. The suites that make the gate expensive (`lint`, `test-worker`) cannot move. The work is: create and connect 3–5 additional Workers purely as CI shards (each a real Worker in the account, with a wrangler config, a name, and watch paths, deploying nothing); write per-shard build commands; solve check-run naming; accept that no required status can safely aggregate them; keep the GitHub gate for everything else. **Net: two platforms, ~$13–66/month saved, and the branch-protection story gets worse.** Not recommended.

**Full migration: not possible.** `lint` exceeds both the timeout and the memory ceiling; `containers` exceeds the timeout by 4.5×; `changes` and `gate` are inexpressible. This is not an effort estimate — there is no configuration that gets there.

**Stay and optimize: 1–2 days for the cheap win, plus the refactor already planned.** (a) Move the short jobs to `runs-on: ubuntu-latest-1-core` or equivalent — hours, −67% on those jobs. (b) Re-measure the whole-repo lint before restoring the suspended tier, and consider whether the nightly sweep needs to be nightly. (c) Prosecute the `apps/worker` dependency-shape fix as the real cure. **Recommended.**

**Regardless of the above, one small thing is worth doing: spike A.** Push a throwaway branch with a Workers Builds configuration whose build command runs `pnpm exec vp test run apps/worker` and whose deploy command is a no-op, and see whether `vitest-pool-workers` starts. **About an hour**, and it converts section 6's well-founded inference into a fact. It costs a few build minutes from an allowance we are not using. Worth doing for the knowledge even though the timing analysis already decides the question.

---

## 9. Owner decision points

1. **Accept or reject the recommendation** (section 1): keep the gate on GitHub Actions, keep deploys on Workers Builds, and treat the CI bill as a gate-cost problem rather than a platform problem. Rejecting it means accepting section 8's hybrid at ~$13–66/month for two platforms.
2. **Approve the 1-core runner change** (section 7.3) — the largest saving available for the least work, no migration, reversible in one commit. This is the recommended immediate action.
3. **Prioritize the `apps/worker` dependency-shape refactor.** It is already on the roadmap as a build-latency item; the measured data says it is also **43% of the CI bill**. That is a re-prioritization decision, not a new piece of work.
4. **Decide the fate of the suspended tiers before the minutes reset.** The austerity stream (`claude/ci-austerity`) suspended the nightly sweep, the push-to-`main` tier, and the whole-repo lint. Restoring all three restores the bill. Restoring some is a coverage decision with a price attached, and section 7 gives the price.
5. **Whether to fund a build-minutes budget at all**, and at what monthly ceiling. The measured range is $128–658/month on the current shape. Every option in this document is a way of moving within that range, not escaping it.
6. **Note the undocumented Docker dependency** (section 4.3). The deploy pipeline depends on a Workers Builds property Cloudflare does not document and therefore does not promise. Worth a watch item, independent of everything else here.

---

## 10. Sources

**Primary — the `developers.cloudflare.com/workers/ci-cd/` tree**, both halves, crawled 2026-08-05:

- [CI/CD overview](https://developers.cloudflare.com/workers/ci-cd/) · [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) · [Limits & pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) · [Build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) · [Build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/) · [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) · [Advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/) · [Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/) · [Troubleshooting](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/)
- External CI/CD half: [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) · [GitLab CI/CD](https://developers.cloudflare.com/workers/ci-cd/external-cicd/gitlab-cicd/) · [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action)

**Supporting Cloudflare documentation:** [Pages GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) (the check-run / skipped-build language) · [Containers image management](https://developers.cloudflare.com/containers/platform-details/image-management/) · [Sandbox](https://developers.cloudflare.com/sandbox/) · [Docker-in-Docker changelog, 2026-02-17](https://developers.cloudflare.com/changelog/post/2026-02-17-docker-in-docker/) · [Containers and Sandboxes GA, 2026-04-13](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/) · [Workers Builds launch post](https://blog.cloudflare.com/workers-builds-integrated-ci-cd-built-on-the-workers-platform/)

**GitHub pricing:** [Actions billing concepts](https://docs.github.com/en/billing/concepts/product-billing/github-actions) (2,000 min Free / 3,000 Pro / 3,000 Team / 50,000 Enterprise Cloud for private repositories; Linux 1-core $0.002, 2-core x64 $0.006, 2-core arm64 $0.005 per minute) · [2026 Actions pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)

**Third-party:** [`cloudflare/workers-sdk#10600`](https://github.com/cloudflare/workers-sdk/issues/10600) — `vitest-pool-workers` reliability in containerised Linux CI.

**Measured, this repository:** gate run [`30963909970`](https://github.com/Phauks/magna-carta/actions/runs/30963909970) (pull request, 17 jobs, 2026-08-05) via the Actions API — per-job durations in sections 5 and 7.

**In-repo:** `.github/workflows/gate.yml` (removed 2026-09-16; its successor is [`tooling/gate/`](../../tooling/gate/index.mjs)) · [`build-performance.md`](../conventions/build-performance.md) · [`operations.md`](../conventions/operations.md) (the Workers Builds runbook) · [`vite.config.ts`](../../vite.config.ts) (the `rust-wasm-build` Docker evidence) · [`operating-costs.md`](../operating-costs.md) · [`2026-08-04-cloudflare-agents-assessment.md`](2026-08-04-cloudflare-agents-assessment.md) (the prior Reddit-link precedent) · ADR-0075 as amended, ADR-0078.

**Unreadable:** the owner-supplied Reddit thread (section 2).
