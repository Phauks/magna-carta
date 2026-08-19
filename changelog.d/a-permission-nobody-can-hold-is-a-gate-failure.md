---
category: Added
audience: internal
---

**A sixteenth repo-wide lint, `pnpm run lint:ungranted-permissions`,** fails any permission that
gates a member-facing surface and that no committed seed grants to any role. It is the sibling of
`lint:unwired-writes` for a defect that gate is structurally unable to see: these are permissions
rather than writes, so nothing is exported, nothing is uncalled, and the route the permission gates
has a caller, a test and a correct chokepoint check. The only symptom is a 403.

**Two demand sources, both surfaces a member reaches.** A chokepoint-enforced route, read out of the
committed OpenAPI snapshot (`defineOpenAPIRoute` writes `x-mc-permission` and `x-mc-surface` onto
every operation, and a byte-exact test fails if the snapshot drifts from the code — so the fact is
already committed in a shape with no parsing ambiguity); and a Tools catalogue manifest, since
`toolsByGroup` renders only the tools whose permission the member holds. Grants come from every
`role_permission` and `direct_grant` seed in both migration lineages, read by column name rather than
by position so a seed written with its columns reordered still counts.

**Measured in four variants against `main` at the commit this branched from — 102 declared
permissions, 90 seeded — and the two wider ones were rejected:**

| Variant                                         | Hits | Real | False |
| ----------------------------------------------- | ---- | ---- | ----- |
| Every declared permission with no seed          | 12   | 9    | 3     |
| Every permission named by **any** route meta    | 7    | 4    | 3     |
| Named by a `surface: "app"` route meta          | 5    | 4    | 1     |
| **Kept:** that, plus a Tools catalogue manifest | 10   | 9    | 1     |

The middle form is the worst of the four and worth naming: it drops the five real Tools cases and
keeps all three false ones. Excluding `surface: "public"` is what removes two of the three, and it is
grounded rather than fitted — the chokepoint skips its session, authn and RBAC steps entirely for a
public surface, so a role holding `firm:provision` would gain nothing. The single remaining exception,
`diagnostics:overview`, is on the allowlist with the reason: a diagnostic support session carries the
whole `diagnostics` namespace through `resolveSupportPermissions`, and a role that held it would give
every member of the firm the help-desk view the tier exists to keep separate.

**Replayed against 2026-06-22, it names the defect on the commit that shipped it.** At `0185ce46`,
the commit immediately before the editor-launch route landed, the rule reports seven and no
`documents:*` — correct, the routes did not exist. At `507d9f9b`, the commit that added the route, it
reports eight, and the new one is `documents:edit`. At `0f4d53fa` it picks up `documents:checkout`.
Fifty-eight days before the gap was found by reading. Every hit in that replay was real: besides the
editing keys and the five Tools manifests still ungranted today, it names `customFields:purge` and
`tools:speedTest`, both of which were genuinely unheld then and were seeded later.

Same shape as its two siblings — pure rules beside an impure runner, fixtures the gate self-tests
against on every invocation and that the suite drives through the same entry point, two vacuity
guards (no demand collected, no seed collected), and a per-permission allowlist whose entries each
carry a required reason. A blank reason, an entry no surface demands any more, and an entry whose
permission a seed now grants are each failures of their own, so the gate cannot go quiet by accident.

What it does **not** catch, and no rule here pretends otherwise: a permission granted to a role no
member holds, and a capability with no permission at all.
