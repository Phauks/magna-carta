---
number: 390
slug: a-permission-no-role-can-hold-is-a-gate-failure
status: Proposed
date: 2026-08-19
area: Platform / Architectural integrity
summary: "A sixteenth repo-wide lint, pnpm run lint:ungranted-permissions, fails any permission that gates a member-facing surface and that no committed seed grants to any role. Demands come from two places: a chokepoint-enforced route, read out of the byte-exact OpenAPI snapshot where defineOpenAPIRoute writes x-mc-permission beside x-mc-surface, and a Tools catalogue manifest, which is what toolsByGroup filters on. Measured in four variants against main before it was kept: every declared key with no seed reports 12 with 3 false; every key named by any route meta reports 7 with 3 false and drops all five Tools cases; surface app routes alone report 5 with 1 false; the kept form — that plus the catalogue — reports 10 with 1 false, allowlisted with its reason. Replayed against 2026-06-22 it names documents:edit on the very commit that introduced the route, fifty-eight days before the gap was found by reading, and every hit in that replay was real. Excluding surface public is grounded in the chokepoint's own code rather than fitted to the data."
---

**A permission nobody can hold is a capability nobody can reach, and it is invisible from every
direction that normally catches a defect.**

**Context.** `lint:unwired-writes` catches an exported write with no production caller. It could not
have caught this one: the co-editing surface's four permissions were declared in the registry, named
by routes that were registered, enforced correctly by the chokepoint, and granted by no seed — so
every member of every firm got a 403 for two months. Nothing is exported and uncalled here; the
defect is a missing row in a migration, and the only symptom in production is a refusal that reads
exactly like a firm having configured things that way. The test suites could not see it either,
because each editing suite inserted its own `direct_grant` before asserting anything.

The reason this is a hard error rather than a smell is
[a-seed-is-the-whole-supply-so-an-ungranted-permission-is-a-refusal](0391-a-seed-is-the-whole-supply-so-an-ungranted-permission-is-a-refusal.md):
`role_permission` and `direct_grant` have no write statement anywhere in the product, so an ungranted
permission is permanent rather than a default somebody can change.

**Decision.** `tooling/lint-ungranted-permissions`, wired as `lint:ungranted-permissions` in the root
`package.json`, which is how the repo-wide gate discovers its members. One rule: a permission
DEMANDED by a member-facing surface must be GRANTED by some committed seed.

- **Demands, source one:** an operation in `apps/worker/openapi/openapi.json` whose
  `x-mc-permission` is a string and whose `x-mc-surface` is `app`. The snapshot rather than the
  TypeScript, because `defineOpenAPIRoute` emits both keys onto every operation and a byte-exact test
  fails if the snapshot drifts from the code — the fact is already committed in a shape with no
  parsing ambiguity, and it is the only place `surface` and `permission` sit beside each other for
  every route at once.
- **Demands, source two:** a `permission: assertPermission("…")` in `packages/tools/src/catalog.ts`.
  `toolsByGroup` and `toolsFor` in `packages/tools/src/select.ts` render only the tools whose
  permission the member holds, so a manifest nobody can satisfy is a tile nobody has ever seen.
- **Grants:** every `role_permission` or `direct_grant` `INSERT` in either migration lineage, with
  the permission read by **column name** rather than by position, so a seed written with its columns
  reordered still counts. A seed whose permission is not a plain literal is skipped rather than read
  as granting nothing, because a miss there would be a false alarm about a correct permission.

**The measurements that set the shape.** All four forms were run over the tree as it stood before the
repair — 102 declared permissions, 90 seeded:

| Variant                                                     | Hits | Real | False | Note                                                        |
| ----------------------------------------------------------- | ---- | ---- | ----- | ------------------------------------------------------------ |
| Every declared permission with no seed                      | 12   | 9    | 3     | Cannot tell a capability from nominal metadata               |
| Every permission named by **any** route meta                | 7    | 4    | 3     | The worst: drops all five Tools cases, keeps all three false |
| Named by a `surface: "app"` route meta                      | 5    | 4    | 1     | Loses the Tools half                                         |
| **Kept:** that plus a Tools catalogue manifest              | 10   | 9    | 1     | The one exception is allowlisted with its reason             |

The three false positives in the first two rows are `firm:provision`, `support:mintSession` and
`diagnostics:overview`. The `surface: "public"` exclusion removes the first two and is grounded in the
chokepoint's own code rather than fitted to the data: `chokepointMiddleware` skips steps one to three
— session, authn, RBAC — entirely for a public surface, so the `permission:` on such a route never
gates anything and a role holding it would gain nothing.

**The replay is what earns it.** Run against the tree as it stood on 2026-06-22:

| Commit                                              | Problems | The new one                          |
| ---------------------------------------------------- | -------- | ------------------------------------- |
| `0185ce46` — WOPI lock family (before the routes)   | 7        | none: no `documents:*` yet, correctly |
| `507d9f9b` — the editor-launch route                | 8        | **`documents:edit`**                  |
| `0f4d53fa` — the offline checkout route             | 9        | **`documents:checkout`**              |

Fifty-eight days before the gap was found by reading. Every hit in that replay was real: besides the
editing keys and the five Tools manifests that were still ungranted today, it names
`customFields:purge` and `tools:speedTest`, both genuinely unheld at that commit and seeded later.
Nothing on the list was a false alarm at any of the three points.

**Considered and rejected.**

- **Every declared permission with no seed** — the simplest rule and the one most likely to be
  written by reflex. Rejected at 12 hits with 3 false: a quarter of what it says is noise a reader
  has to re-derive on every run, and the whole design constraint here is failing rarely.
- **Every permission named by any route meta** — rejected at 7 with 3 false, and it is worse than it
  looks: it keeps every false positive and loses the five real Tools cases, so it is strictly
  dominated by both neighbours.
- **Reading the RouteMeta out of the TypeScript** — a balanced-brace scan for an object literal
  carrying both `surface:` and `permission:`, which also has to cope with a route naming its
  permission through a constant. Rejected: the snapshot already holds the answer, is generated from
  the same declarations, and is gated against drift.
- **Leaving it as an occasional probe** — legitimate, and the answer given to plenty of candidate
  rules on this program. Rejected here on the replay: the question is worth asking, this shape has
  now produced four shipped-but-unreachable subsystems in one day of looking, and the run costs about
  a tenth of a second.

**The allowlist is the review, and it cannot decay silently.** One entry today —
`diagnostics:overview`, with the reason that `resolveSupportPermissions` hands a diagnostic support
session the whole `diagnostics` namespace and seeding it to a role would give every member of the
firm the help-desk view the tier exists to keep separate. Three further conditions are failures of
their own: a blank reason, an entry no surface demands any more, and an entry whose permission a seed
now grants. Two vacuity guards fail the run if either side collects nothing, which is how a renamed
extension key or a moved migration directory would otherwise turn the gate into a no-op nobody
notices. The rules self-test against fixtures on every invocation, the same shape as
`tooling/lint-ledger-staleness` and `tooling/lint-unwired-writes`.

**Consequences.** Under a tenth of a second, in the always-on repo-wide set, discovered automatically
because that set is derived from the `lint:*` scripts rather than hand-listed. A route registered
against a permission its slice forgot to seed fails on the pull request that adds it. What the gate
does **not** catch, and no rule here pretends otherwise: a permission granted only to a role that no
member of a firm holds, a capability enforced somewhere other than the chokepoint or the Tools
catalogue, and the reach problem underneath all of this — that a firm still has no surface by which
to grant, revoke, or create anything at all.
