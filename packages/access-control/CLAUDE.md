# @magna-carta/access-control — CLAUDE.md

**Purpose.** The platform permission registry, the resolver that turns a member's rows into their
effective permission set, and the platform-operator decision. Pure and dependency-free: no D1, no
Hono, no `env`, no network. It decides nothing about a request — the chokepoint
(`apps/api-worker/src/http/chokepoint/`) enforces, this package supplies the vocabulary and the arithmetic.

**White paper:** _Authentication & encryption_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0067.)

## Key files / entry points

- `src/registry.ts` — `PERMISSIONS`, the fixed `<subsystem>:<action>` list, plus the `Permission`
  brand and its guards (`isPermission`, `assertPermission`, `permissionsForNamespace`). The brand is
  compile-time only, so it costs nothing on the wire.
- `src/resolver.ts` — `effectivePermissions(rolePermissions, directGrants, now)`: the union of the
  member's role rows and their unexpired direct grants.
- `src/platform-operator.ts` — the platform-trust decision (membership plus two-factor), a separate
  axis from any firm's permissions.

## The fact that decides how a new permission is landed

**A permission with no migration seed is a permanent refusal, not a default a firm can change.**
`effectivePermissions` has no wildcard, no owner bypass and no namespace fallback, and
`packages/data-access` holds only `SELECT`s over `role_permission` and `direct_grant` —
`selectMemberPermissionsStatements` and nothing else. No route, consumer or sweep writes either
table, and firm provisioning assigns a member to a role rather than amending what a role carries. So
the per-firm seed migrations are the **entire supply**, and there is no narrow-then-widen path a firm
can walk on its own.

Two consequences bind here:

- **Adding a key to `PERMISSIONS` is half the work.** The other half is a `role_permission` seed in
  the same commit, in `packages/database/drizzle/per-firm/`. Nine keys were declared without one and
  four of them gated the co-editing surface for two months, refusing every member of every firm with
  a 403 that reads exactly like a firm having configured things that way.
  `pnpm run lint:ungranted-permissions` (`tooling/lint-ungranted-permissions/`) now fails the next
  one: it takes every permission a chokepoint `surface: "app"` route or a Tools catalogue manifest
  names, and demands a seed behind it.
- **A deliberately narrow seed still has to be reachable by somebody.** "Narrow, and a firm that
  wants it wider reaches for a direct grant" is a sentence several seed migrations carry, and it
  describes an intention rather than today's product — there is no surface that writes a direct
  grant. Seed to the narrowest set that leaves the capability genuinely usable, and record the
  widening as an `awaiting-owner:` line on the ledger node rather than as a comment assuming a
  mechanism that does not exist yet.

## Local conventions

- **`KnownPermission` for hardcoded, compile-checked keys** (route metadata, seeds);
  `Permission` for runtime-validated strings, which must go through `isPermission`/`assertPermission`
  to acquire the brand. A raw string is deliberately not assignable to `Permission`.
- **A registry comment says who the key is for, not who holds it.** The seat split lives in the seed
  migration, where the reasoning sits beside the rows it explains; restating it here gives one fact
  two homes that drift.
- **`effectivePermissions` filters unknown keys rather than throwing.** A registry that shrank must
  not brick sign-in. Expiry compares ISO-8601 UTC instants lexicographically, which requires the
  fixed-width millisecond `toISOString` form — the database write path owns that invariant in its
  single formatting layer.

## Invariants that apply here

- **This package is pure.** No filesystem, no network, no `env`, no database handle. The caller reads
  the rows; this decides over them. That is what lets the resolver be exercised without a firm.
- **The platform-operator axis is separate from every firm's permissions** and always requires
  two-factor — a platform-trust identity does not rest on a password alone.

## Dependencies & contracts

- Depends on nothing. Consumed by `@magna-carta/data-access` (which is why
  `platform-operator.ts` restates its input row shape locally rather than importing it — importing
  back would close a workspace dependency cycle), by `apps/api-worker`'s chokepoint and session context,
  and by `@magna-carta/tools` for the `Permission` type on each manifest.
- The seeds that make a permission real live in `@magna-carta/database`; the fitness function in
  `packages/database/test/generated-migrations.test.ts` holds the other direction — every seeded
  permission is a registered one.

## Gotchas

- **A permission granted to a role no member holds is invisible to the scan and to the resolver
  alike.** The gate asks whether some role carries the key, not whether some member carries the role.
- **The Owner/Admin role is not privileged in code.** It holds the most keys because the seeds give
  it the most keys; nothing anywhere treats it specially, so a capability missing from its seed is
  missing from it.
