# The api worker as a manifest of domain modules — design

**Date:** 2026-09-18
**Status:** Proposed; steps 1, 2 and 3 of the migration plan (section 10) are built on the branch — the foundations and the four fitness tests; the domain directories, the manifest, the per-domain operation lists and the split of the area note; and the `http/` and `background/` split with the boundary enforced by directory. The emitted contract is identical to the one before the move after a canonical key sort; the committed snapshot and client carry the reordering only. The owner walked the assessment on 2026-09-18 and accepted items 1 through 4 and 7 below, asked for the lint that makes 1 safe, asked for 5 to be double-checked (it was, and it changes shape: section 8), and asked whether the registries in 6 are hand-maintained (two of three are: section 9).
**Scope:** the internal shape of `apps/api-worker` — how its route surface is organized, where a contract shape lives, where the boundary between the HTTP side and the background side runs, and the checks that keep that shape from regrowing.
**Excludes:** the deployment topology (whether the background machinery is a second Worker — settled, and restated in section 8); the contract itself (`docs/conventions/api.md`); the chokepoint's enforcement order (ADR-0067); anything a caller can observe. A client that could tell this work happened is a bug.

**Binding inputs:** ADR-0066 and ADR-0067 (code-as-contract, the metadata chokepoint); ADR-0138, ADR-0167 and the extraction rubric in [`../conventions/operations.md`](../conventions/operations.md) (the compute-vs-coordination seam, and the 2026-08-21 ruling that the API surface and the background orchestration stay one Worker); [`../conventions/build-performance.md`](../conventions/build-performance.md) (_A Worker entrypoint spends a validated startup budget_); golden rules 1, 8, 9, 12 and 13.

---

## 1. What is wrong, measured

The worker is large in one specific way. Of its 105,148 source lines, 74,765 are `src/http/routes/`: 99 files in one flat directory, holding 714 route definitions that emit 631 operations. The four largest route files (calendar, directory, custody, billing) are each over 3,000 lines. Domain logic is not the weight — `routes/calendar/calendar.ts` imports twenty modules from `@magna-carta/calendar` and holds no business rule of its own. The weight is contract shape and handler glue: 453 `z.object` constructions across the route files, 237 of them in calendar alone, and 891 `.openapi("Name")` component registrations, all built at module scope.

`app.ts` is three things in one 1,019-line file: the composition root (the ports, the auth instance, the loggers), the single home of the `Bindings` type, and a manifest of about 116 `register…` calls behind about 120 imports. Hono matches in registration order, so the order of those calls is load-bearing, and the area note records two places where moving a line breaks matching. Every new surface adds an import and a call to the one file everything else depends on: 88 non-route files import `Bindings` from it, so the queue consumers and the Durable Objects depend on the HTTP composition root, the reverse of the direction the seam wants.

The startup budget was crossed once already (2026-08-31). The dynamic-import fix moved the cost from deploy validation to the first request, but every route module still builds its schemas when it is evaluated, so the first request to a fresh isolate pays for all 631 operations whichever one it asked for. That cost is linear in routes and nothing in the gate measures it.

Three registries stand outside the modules and must be touched for every new route: the hand-maintained list of 631 operation ids in `test/conformance.test.ts` (the not-vacuous guard), the area note itself (524 lines, absorbing every surface's local rules), and the committed snapshot, 3.1 MB regenerated as one unit and feeding a single 58K-line generated client.

Churn is low (50 commits in 90 days, two touching `app.ts`), so this is not a collision problem. It is a cognitive, cold-start and build-scaling problem, and it compounds with every feature.

## 2. The decision in one paragraph

**The worker becomes a manifest of domain modules, each a self-contained sub-app, with its contract shapes held by the domain package and its enforcement unchanged.** `src/http/routes/` gains one directory per domain; each directory builds its own typed `OpenAPIHono` through one shared constructor, registers its routes through the same `chokepointMiddleware` it uses today, and is mounted by `app.ts` in a manifest of about twenty lines. The request and response shapes a route declares move to `packages/<domain>/src/contract.ts`, so the domain package is the one home for what its API accepts and returns and the route file is glue. Inside the worker, the HTTP side and the background side are separated by an import boundary a fitness test holds, and `Bindings` moves out of `app.ts` into a module both sides may import. The guards that make this safe are the ones that already exist (the registration-time meta assertion, the byte-exact snapshot, the conformance suite) plus four small fitness tests that stop the shape regrowing.

## 3. The domain module

A domain module is a directory `src/http/routes/<domain>/` with one entry, `index.ts`, exporting one function:

```ts
export function mount<Domain>(app: AppRouter, chokepoint: Chokepoint, deps: <Domain>Deps = {}): void;
```

Inside, the module builds its sub-app through the one constructor, registers every route on it, and mounts it at the root:

```ts
const domain = createDomainApp();
registerCalendarEvents(domain, chokepoint);
registerCalendarResources(domain, chokepoint);
app.route("/", domain);
```

Four rules bind the shape:

- **One constructor, `createDomainApp()`, in `src/http/routes/domain-app.ts`.** It builds `new OpenAPIHono<{ Bindings; Variables: AppVariables }>({ defaultHook })`. The `defaultHook` is per instance in `@hono/zod-openapi`, so a sub-app built without it would answer a validation failure with the library's default rather than the 422 problem document every other route returns. That is the one way a sub-app could silently diverge from the contract, and it is why the constructor is the only sanctioned way to build one (held by a fitness test, section 9).
- **Routes register exactly as they do today.** `app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, handler)`, with `route` from `defineOpenAPIRoute`. The registration-time assertion in `src/http/chokepoint/register.ts` runs when the sub-app registers the route, not when `app.ts` mounts it, so a route with no meta or an unregistered permission still throws at startup. Nothing about enforcement moves.
- **Paths stay absolute.** Routes keep declaring `/api/v1/...` in full and the sub-app mounts at `/`. Domains do not map to path prefixes: eleven of today's route files live under `/api/v1/matters` and ten under `/api/v1/firm`, so a prefix-mounted sub-app would either split a domain across mounts or merge unrelated ones. Absolute paths also keep the emitted document identical, because `route()` merges the sub-app's registry into the parent with the mount path prefixed, and a prefix of `/` prefixes nothing (verified against `@hono/zod-openapi` 1.5.1, `src/index.ts`, the `route` override).
- **Order is a local fact.** Where two of a domain's patterns overlap (`GET .../time-entries/rounding-policy` before `GET .../time-entries/{id}`), the order lives inside the module, next to the routes it orders, with the comment that explains it. Across domains there is no overlap to order, and the route-table fitness test (section 9) proves it rather than assuming it.

The parent app keeps everything cross-cutting: the telemetry middleware and error boundary, the usage-reached middleware, the crawler directives, the dev control-plane bootstrap, the auth attempt budget on `/api/auth/*`, the OpenAPI document route and the Better Auth mount. Parent middleware registered with `app.use` composes ahead of a mounted sub-app's handlers, so none of it moves.

## 4. The manifest

`app.ts` shrinks to the composition root plus a manifest. The starting grouping follows the domain package where one exists and today's path family where none does; it is a first cut the build refines, not a ruling, and the only hard rule is that a route file lives in exactly one module.

| Module            | Route files it absorbs                                                                                                                                                                                                                                               | Domain package                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `session`         | me, me-name, members, member-profiles, member-administration, invitations, registrations, onboarding                                                                                                                                                                 | `access-control`                                                                        |
| `firm`            | firm-profile, firm-notification-policy, firm-report-policy, firm-time-policy, firm-ai-settings, firm-usage, release-channel, numbering, scan-policy, auto-file-policy, download-preferences, custom-fields, matter-types, document-types, classification-type-routes | `custom-fields`, `sequence-numbering`, `feature-flags`                                  |
| `platform`        | firms, platform-release-channel, platform-status, platform-operator-guard, incidents, health, meta-versions, meta-database-health                                                                                                                                    | `status`, `build-identity`                                                              |
| `matters`         | matters, matter-records, matter-search, matter-assets, matter-plans, intake, locations                                                                                                                                                                               | `matters`, `matter-search`, `matter-assets`, `intake`, `locations`                      |
| `notes-and-tasks` | notes, tasks, my-day                                                                                                                                                                                                                                                 | `notes`, `tasks`                                                                        |
| `calendar`        | calendar                                                                                                                                                                                                                                                             | `calendar`                                                                              |
| `directory`       | directory, conflicts                                                                                                                                                                                                                                                 | `directory`, `conflicts`                                                                |
| `timekeeping`     | time-entries, timer, rate-cards, utbms-codes, non-billable-categories, narrative-templates, fees                                                                                                                                                                     | `timekeeping`, `fees`                                                                   |
| `billing`         | billing, costs, reports, report-exports                                                                                                                                                                                                                              | `billing`, `billing-core`, `costs`, `reporting`                                         |
| `trust`           | trust, trust-firm-funds, trust-reconciliation, trust-unclaimed-funds                                                                                                                                                                                                 | `trust`, `ledger`                                                                       |
| `files`           | files, folders, uploads, upload-readiness, downloads, downloads-register, bundle-status, file-scans, scan-diagnose, scan-matter, file-integrity, file-type, file-repair, metadata, ocr, ai-detection, decryption, recovery, and `files/preview-serve`                | `file-manager`, `file-type`, `file-integrity`, `metadata`, `ai-detection`, `decryption` |
| `documents`       | templates, assemblies, conversions, document-seal, and the three editing route modules                                                                                                                                                                               | `document-assembly`, `conversion`, `signing`                                            |
| `email`           | emails, capture-addresses, email-inspector, email-add-in, auto-file-rules                                                                                                                                                                                            | `email`, `email-filing`                                                                 |
| `discovery`       | discovery, discovery-coding, discovery-review-reads, and `search/split-object-host`                                                                                                                                                                                  | `discovery`, `search`                                                                   |
| `custody`         | custody                                                                                                                                                                                                                                                              | `custodian`                                                                             |
| `communications`  | communications, shipping                                                                                                                                                                                                                                             | `communications`, `shipping`                                                            |
| `notifications`   | notifications, notification-preferences                                                                                                                                                                                                                              | `notifications`                                                                         |
| `magnus`          | magnus                                                                                                                                                                                                                                                               | `magnus`                                                                                |
| `tools`           | tools-connection, tools-turn-credentials, whois, safe-browse                                                                                                                                                                                                         | `tools`, `whois`, `safe-browse`                                                         |
| `support`         | support-grants, support-sessions, support-diagnostics                                                                                                                                                                                                                | (worker-local `src/support/`)                                                           |
| `developer`       | dev-r2-upload, dev-seed, dev-web-tools-demo                                                                                                                                                                                                                          | none; dev-only, unchanged                                                               |

Where a route module today reaches a sibling route module (`classification-type-routes`, `platform-operator-guard`, the two intake and discovery helpers), the shared piece moves into the module both belong to or, when they belong to different modules, into `src/http/routes/shared/` with no route of its own. A route module never imports another domain's `index.ts`.

## 5. Contract shapes live in the domain package

Today a route file declares its request and response shapes inline, which is why calendar carries 237 schema constructions and why the shape of what the calendar API accepts is findable only by reading the worker. The shapes move to `packages/<domain>/src/contract.ts` (or a `contract/` directory when one file would be the calendar), exported as plain zod schemas and their inferred types. The route file imports them and composes `defineOpenAPIRoute` over them.

Two rules keep the boundary clean:

- **Packages export plain zod and name their components with zod's own metadata** (refined in the build, 2026-09-24). `.meta({ id: "Name" })` on the schema in the package is what the emitter reads as the component name, and it produces components byte-identical to the worker's `.openapi("Name")` — proved on the calendar, whose emitted document did not change by a byte. Naming on the instance in the package is also what keeps a package-side composition a ``rather than an inlined copy, which the route-side naming the spec first proposed would have broken. The helpers a shape needs moved beside it:`identifierField`to`@magna-carta/identifiers/field`, the list envelopes to `@magna-carta/data-access/pagination-contract`.
- **Path and query parameters may stay with the route.** They are addressing, not domain shape. A body or a response is domain shape and belongs to the package. The cap in section 9 is set so that a route file holding only its parameter schemas passes and one holding bodies does not.

The web is unaffected and keeps reading the generated client (ADR-0066); the package schema serves the worker and the package's own tests, and it is what lets a domain test assert "this service's result satisfies its own response contract" without booting the worker.

## 6. The seam inside the worker

The 2026-08-21 ruling keeps the background orchestration in this Worker (section 8), and the reasoning holds. What it did not rule on is the shape inside the repository, and that is where the coupling actually costs: 88 non-route files import the `Bindings` type from `app.ts`, and ten files outside the route tree import from Hono.

- **`Bindings` moves to `src/bindings.ts`**, the no-barrel single home for the env shape, with `worker-env.d.ts` mirroring it as today. `app.ts` imports it like everything else.
- **The tree splits into an HTTP side and a background side.** `src/http/` holds the app, the chokepoint, the contracts helpers, the middleware and the route modules; `src/background/` holds the queue consumers, the cron sweeps and their router; the Durable Objects and the shared machinery (`firm-database/`, `files/`, `emails/`, `search/`, the provisioners) stay where they are as shared code both sides reach. The move is a rename with no logic change, done in its own commit so review is mechanical. After it the route tree is `src/http/routes/`; sections 3 and 4 name it by its path before the move, section 9 by its path after.
- **The boundary is held, not trusted.** A fitness test asserts that nothing under `src/background/` imports from `src/http/` or from `hono`, and that nothing under `src/http/routes/` imports a consumer or a sweep. The ten files that import Hono outside the route tree today are all HTTP concerns (problem-document helpers, middleware, the session accessor) and move to the HTTP side; a consumer that needs one of them is the case the boundary exists to surface.

This keeps a background Worker cheap to cut if the ruling is ever revisited, without paying for a second deployable now.

## 7. Orchestration into packages

`src/background/scheduled.ts` (1,301 lines) and several consumers carry logic that needs only a database handle, a bucket and a clock: the digest cadence, the storage reconciliation, the notification comparison and retention sweeps, the provisioning consumers. The rule routes already follow applies: the worker holds thin adapters, the package holds the logic behind a port, and the package tests it without a Worker. This is the same seam the conversion and assembly consumers already sit on (`resolveEnginePort` injectable at the consumer). It is a separate slice after sections 3 through 6, one sweep or consumer per pull request, because each move is a judgement about which package owns the rule.

## 8. What is deliberately not done

**Lazy per-domain loading.** The assessment proposed importing a domain on the first request to its prefix so cold start scales with domains touched. Checked, and it does not work as described, for two reasons. Hono's default router builds its matcher on the first request and refuses additions afterwards: at the pinned 4.13.0, `SmartRouter.add()` throws `Can not add a route since the matcher is already built.` once `match()` has run, so a domain cannot be mounted into the live app on first hit. And domains do not map to prefixes (section 3), so a prefix table cannot select a domain. The workable shape is a per-domain app held behind a dispatcher that imports on first hit and forwards to that app's `fetch`, with the cross-cutting middleware in the outer app and a second, eager composition for the emitter, the conformance suite and the routing scan. That is two compositions that must agree, and a test to prove they do. It is deferred until a measurement says the cold-start cost is worth that second composition; the measurement is added now (section 9), so the decision is made on a trend.

**A background Worker.** Asked and settled on 2026-08-21, recorded in the extraction rubric: routes address six of the nine job coordinators (the poll and subscribe endpoints are routes), and 28 test files use `runInDurableObject`, which works only on classes defined in the Worker under test. A split would make both Workers bind nearly everything and pull the test harness apart. Section 6 keeps the option cheap; this spec does not reopen it.

**Splitting the generated client.** It is generated, not hand-maintained, and `@hey-api/openapi-ts` emits one SDK file from the whole document with no per-tag output in the pinned version. Leave it.

## 9. The guards

The move is safe because of what already exists, and stays safe because of four small additions. The three source scans self-register with the repo-wide-fitness tag, so they run in the gate's governance dimension unconditionally; the route table runs with the worker's suite.

**Already there, and load-bearing for the move:**

- The registration-time assertion (`assertRouteHasMeta`) — a route with no meta or an unregistered permission throws at startup, wherever it registers.
- The byte-exact snapshot test — the emitted document must equal `openapi/openapi.json`. The migration's acceptance criterion is a document identical to today's after a canonical key sort (the registry order changes when routes regroup by domain, and only the order); the re-emitted snapshot and regenerated client are committed in the same pull request, and a reviewer confirms the diff is reordering only.
- The conformance suite — permission-namespace binding, `files:*` on `resource: "matter"`, the required-idempotency and non-JSON-body checks, over the assembled document.
- The worker-first routing scan — the `run_worker_first` array against the live dispatch table.

**Added by this work:**

1. **Route table.** For every operation in the assembled document, Hono's router resolves its method and path template to the route registered under that same template. It runs in the worker's own Vitest project rather than the repo-wide sweep, because it needs the built app, not the source text. This is the check the owner asked for in accepting section 3: a route that another route shadows, or a module mounted so that a pattern claims a literal, fails here by name rather than as a 422 in production. It is also what makes cross-domain ordering a proven non-issue.
2. **Route hygiene.** Under `src/http/routes/`: no file constructs `OpenAPIHono` (only `createDomainApp` does); every `app.openapi(` call passes `middleware: chokepointMiddleware(`; no route module imports another domain's `index.ts`.
3. **Size and shape caps.** A ceiling on lines per route file and on `z.object(` constructions per route file, with today's offenders named in an explicit ledger that may only shrink; raising an entry is a reviewed act with its reason in the pull request, never a default. The ceiling is set so a file holding its parameter schemas passes and one holding bodies does not.
4. **Import boundary.** Section 6's rule: the background side imports neither the HTTP side nor Hono; the route tree imports no consumer or sweep.

**Measured, not capped:** `wrangler check startup` joins the gate for this Worker and its total is recorded per run, so a step change is visible. Local CPU is not Cloudflare CPU, so the number is a trend, not a threshold.

**The registries.** The 631-entry operation list in the conformance test becomes one list per domain module, kept beside the module in `src/http/routes/<domain>/operations.ts`, and the whole-document assertion becomes the sum of those lists. The `run_worker_first` array is four entries and already pinned by a test; it stays. The area note splits the same way: each domain module carries its own `CLAUDE.md` for that surface's local rules (the notification-permission split, the two time-entry guards), and the worker's note keeps only what is cross-cutting.

## 10. Migration plan

Each step is one pull request, mergeable on its own, with `main` as production in mind: nothing a caller can observe changes at any step, and the snapshot test is the proof at every one.

1. **Foundations** (built 2026-09-19). `src/bindings.ts`, with `src/auth-instance.ts` and `src/worker-logger.ts` beside it so the provisioning consumer stops importing the app module; `createDomainApp()`, which the root app already builds through; the four fitness tests written against today's tree with every current offender on the ledger, so they pass on day one and fail on regrowth; and the gate's `startup` dimension. No route moves.
2. **The manifest** (built 2026-09-20). The domain directories, 107 route files moved unchanged (three helpers two domains shared went to `src/http/routes/shared/` first: the platform-admin guard, the image helpers, the member-provision topic), one `index.ts` per module carrying the registration comments from `app.ts`, and `app.ts` reduced to the anchored registrations plus a loop over `src/http/routes/manifest.ts`. The snapshot was re-emitted and proved identical after a canonical key sort; the committed snapshot and the generated client carry the reordering only. The conformance list became one `operations.ts` per module, emitted by `emit-domain-operations` through the same Vite pipeline as the snapshot, with the suite mounting each module alone and holding it to its list. The area note's six per-surface sections moved beside their modules. Two refinements to section 4 fell out of the build: the two chokepoint editing routes stay in `src/editing/` beside the Durable Object they serve and are mounted by the documents module, and the token-guarded hosts (`/wopi/*`, `/search-objects/*`), the preview serve, the health probe and the plugin loop stay in `app.ts`, where their position in the registration order is load-bearing.
3. **The seam** (built 2026-09-24). The `http/` and `background/` rename — 218 files, every relative import re-derived from its resolved path rather than by depth — with the boundary test switched from name-based to directory-based: nothing under `src/background/` imports Hono or `src/http/`, nothing under `src/http/routes/` imports `src/background/`, and the allow-list is gone because the two shared symbols it excused (`EmailsCaptureMessage`, `FILE_RESCAN_ACTION`) now live in `emails/capture-types.ts` and `files/ingest-types.ts`. The fire-and-forget helper became `src/http/deferred-work.ts` so its name no longer collides with the directory. `src/http/request-path-sweep.ts` is the one HTTP-side module that reaches a sweep, outside the route tree by design. A rename-only commit apart from those two extractions.
4. **Contract shapes, one domain per pull request**, largest first (calendar, directory, custody, billing), each shrinking the ledger by its own entries. The snapshot proves each one. Calendar (built 2026-09-24): 42 shapes and 11 response envelopes moved to `packages/calendar/src/contract.ts`, the emitted document byte-identical, the route file down from 3,585 to 3,117 lines and from 11 body shapes to 1 by the ratchet's measure — which was refined in the same change to count bodies and responses only, since parameter and query objects stay with the route by design. Directory (built 2026-10-02): 60 shapes moved to `packages/directory/src/contract.ts` with the two values they share (the entity-handle pattern and the address field set), the document byte-identical again, the route file down from 3,437 to 2,558 lines and from 11 body shapes to 5. The move proved one more thing the calendar could not: zod's `.meta()` carries the object-form metadata as well as the name, so a field's `description` survives the move byte for byte. The move is now a script over the TypeScript syntax tree rather than one tailored to each file, and the next domain takes it as it is.
5. **Orchestration into packages** (section 7), one sweep or consumer per pull request, as its own slice.

Steps 1 through 3 are one slice. Step 4 is a series the allow-list tracks to zero. Step 5 is planned after 4 begins.

## 11. Test plan

- The four fitness tests of section 9, each with a fixture tree that fails it, so the test is proven to bite.
- The snapshot and conformance suites unchanged and green at every step.
- The route-table test against the full manifest, plus a deliberate shadowing fixture (a literal registered after a pattern) that it must name.
- For each contract move in step 4: the package gains a test that its service output satisfies its own response schema; the route test file moves with the route and does not change.
- `wrangler check startup` recorded before step 1 and after step 2, so the manifest's effect on the entry graph is a number rather than a belief.

## 12. Open for the owner

- **The module grouping in section 4.** It follows the packages; two judgement calls are `firm` (a settings module by path rather than by package) and `files` (large, because the file manager is). Either could split later along the same rules; the question is only whether to start that way.
- **Where a domain's `CLAUDE.md` rules stop and the convention starts.** The area note has grown by absorbing rulings that were cross-cutting all along (the three-state scan verdict, the never-500 rule). The split in section 9 is the moment to move those to `docs/conventions/`, and that is a judgement per rule.
