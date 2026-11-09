// The ungranted-permission rule, as a pure function over already-collected demands and grants. No
// filesystem here — the impure runner is index.mjs and the fixture test is index.test.mjs, mirroring
// the split in tooling/lint-unwired-writes/rules.mjs and tooling/lint-ledger-staleness/rules.mjs.
//
// WHAT THIS EXISTS FOR. A permission that gates a member-facing surface and that no seed grants to
// any role is a capability nobody in any firm can reach. It is invisible from every direction that
// normally catches a defect: the route is registered, the chokepoint enforces it correctly, the
// registry declares it, the suite passes because each test inserts its own direct grant, and the
// only symptom in production is a 403 that reads exactly like a firm having configured things that
// way. `role_permission` and `direct_grant` have no write statement anywhere in the product, so the
// migration seeds are the entire supply and there is no escape hatch behind an absent one —
// effectivePermissions (packages/access-control/src/resolver.ts) is the union of a member's role
// rows and their unexpired direct grants, with no wildcard and no owner bypass.
//
// The co-editing surface shipped this way and stayed that way for two months: four keys enforced at
// the chokepoint, granted to nobody, so the editor launch, the offline checkout, the check-in, the
// reconcile and the force-release refused every member of every firm. Five Tools catalogue
// manifests shipped the same way and kept four whole subject groups off the Tools page for every
// seat.
//
// THE DESIGN CONSTRAINT, same as its two siblings': failing loudly and RARELY. Every form below was
// measured against the tree as it stood before the repair (102 declared permissions, 90 granted)
// and the two wider forms were measured and REJECTED:
//
//   - "every declared permission that no seed grants" — 12 hits, 3 of them false. It cannot tell a
//     capability from a key that is nominal metadata beside a different guard, so a quarter of what
//     it says is noise the reader has to re-derive every run.
//   - "every permission named by ANY route's meta" — 7 hits, 3 false, the WORST of the four: it
//     drops the five real Tools cases and keeps all three false ones. The `surface: "public"`
//     routes are the whole problem — POST /api/v1/firms and the platform status and release-channel
//     endpoints — and they are false by construction rather than by accident: the chokepoint
//     (apps/api-worker/src/http/chokepoint/chokepoint.ts) skips its session, authn and RBAC steps entirely
//     for a public surface, so their `permission:` never gates anything and a firm role that
//     carried it would gain nothing.
//
// What is kept is the two demand sources that name a surface a MEMBER reaches: a chokepoint-enforced
// `surface: "app"` route, and a Tools catalogue manifest (packages/tools/src/select.ts renders only
// the tools whose permission the member holds). 10 hits before the repair, 9 of them real; the one
// exception is on the allowlist with its reason. Replayed against 2026-06-22, it names
// `documents:edit` on the very commit that introduced the route.
//
// The allowlist is the escape hatch, one entry per permission with a REQUIRED reason, on the same
// marker-plus-reason idiom as `ledger-staleness:allow` and `fitness:allow-no-dimensions`. An entry
// with no reason is itself a failure, and an entry naming a permission that IS now seeded is
// reported too — a stale suppression is how a gate goes quiet without anyone deciding it should.

// Permissions allowed to gate a member-facing surface with no role seed behind them, each with the
// reason. The reason is not decoration: it is the review this gate exists to force, written down
// once so the next reader does not have to re-derive it.
export const ALLOWLIST = new Map([
  [
    "diagnostics:overview",
    "carried by a DIAGNOSTIC SUPPORT SESSION rather than by a firm role — resolveSupportPermissions" +
      " in apps/api-worker/src/support/tier-permissions.ts hands a diagnostic session the whole" +
      " diagnostics namespace, and seeding it to a role would give every member of the firm the" +
      " help-desk view the tier exists to keep separate",
  ],
]);

// Every problem, given the demands found and the permissions any migration seeds.
//
// `demands` is a list of `{ permission, source, where }` — `source` naming which surface demanded it
// ("route" or "tools-catalogue") and `where` the human location. `granted` is a Set of permission
// strings any committed seed grants to any role. `allowlist` is injected so the whole rule runs
// against a fixture in the test rather than against a paraphrase of itself.
export function findUngrantedPermissions(demands, granted, allowlist = ALLOWLIST) {
  const problems = [];

  // One problem per PERMISSION, not per demanding surface: two routes on the same missing key are
  // one missing seed and one migration, and reporting it twice makes the count a lie about how much
  // is wrong. The places are gathered onto the single problem instead.
  const places = new Map();
  for (const demand of demands) {
    const gathered = places.get(demand.permission) ?? [];
    gathered.push(`${demand.where} (${demand.source})`);
    places.set(demand.permission, gathered);
  }

  for (const [permission, where] of places) {
    const allowed = allowlist.get(permission);

    if (allowed !== undefined && allowed.trim() === "") {
      problems.push({
        rule: "empty-allowance",
        permission,
        where,
        detail: "is allowlisted with no reason — state why no role may hold it, or seed it",
      });
      continue;
    }
    if (granted.has(permission)) continue;
    if (allowed !== undefined) continue;

    problems.push({
      rule: "ungranted-permission",
      permission,
      where,
      detail:
        "gates a member-facing surface and no role_permission seed grants it to any role, so no" +
        " member of any firm can hold it — the surface answers 403 to everybody. Seed it in a" +
        " per-firm migration, or allowlist it with the reason no role may carry it",
    });
  }

  // A suppression that has outlived its cause. Reported at the allowlist rather than at a surface,
  // because that is where the edit goes.
  for (const [permission, reason] of allowlist) {
    if (!places.has(permission)) {
      problems.push({
        rule: "stale-allowance",
        permission,
        where: [],
        detail: `is allowlisted ("${reason}") but no member-facing surface demands it any more`,
      });
      continue;
    }
    if (granted.has(permission)) {
      problems.push({
        rule: "stale-allowance",
        permission,
        where: [],
        detail: `is allowlisted ("${reason}") but a seed now grants it — drop the entry`,
      });
    }
  }

  return problems;
}

const routeDemand = (permission, where = "POST /api/v1/thing") => ({
  permission,
  source: "route",
  where,
});
const catalogueDemand = (permission) => ({
  permission,
  source: "tools-catalogue",
  where: "packages/tools/src/catalog.ts",
});

// The fixtures the gate self-tests against on every invocation, and that index.test.mjs drives
// through the same entry point. Each is a shape that was actually seen or actually considered.
export const SELF_TEST = [
  {
    name: "a route permission no seed grants is reported",
    demands: [routeDemand("documents:edit")],
    granted: [],
    allowlist: {},
    expect: ["ungranted-permission"],
  },
  {
    name: "one seed is enough — the gate asks whether anybody can hold it, not how many roles do",
    demands: [routeDemand("documents:edit")],
    granted: ["documents:edit"],
    allowlist: {},
    expect: [],
  },
  {
    name: "a Tools catalogue manifest demands a permission just as a route does",
    demands: [catalogueDemand("tools:attorneyLicense")],
    granted: [],
    allowlist: {},
    expect: ["ungranted-permission"],
  },
  {
    name: "two surfaces on one missing key are ONE problem, not two",
    demands: [
      routeDemand("documents:checkout", "POST /api/v1/documents/{fileId}/checkout"),
      routeDemand("documents:checkout", "POST /api/v1/documents/{fileId}/checkin"),
    ],
    granted: [],
    allowlist: {},
    expect: ["ungranted-permission"],
  },
  {
    name: "an allowlisted permission with a reason is silent",
    demands: [routeDemand("diagnostics:overview")],
    granted: [],
    allowlist: { "diagnostics:overview": "held by a diagnostic support session, never by a role" },
    expect: [],
  },
  {
    name: "an allowlisted permission with a BLANK reason fails on the blank reason",
    demands: [routeDemand("diagnostics:overview")],
    granted: [],
    allowlist: { "diagnostics:overview": "   " },
    expect: ["empty-allowance"],
  },
  {
    name: "an allowlist entry no surface demands any more is reported",
    demands: [],
    granted: [],
    allowlist: { "retired:key": "was platform-only" },
    expect: ["stale-allowance"],
  },
  {
    name: "an allowlist entry whose permission a seed NOW grants is reported, so the gate cannot go quiet",
    demands: [routeDemand("documents:edit")],
    granted: ["documents:edit"],
    allowlist: { "documents:edit": "no seed yet" },
    expect: ["stale-allowance"],
  },
  {
    name: "several ungranted permissions are reported one by one, never rolled up",
    demands: [
      routeDemand("documents:edit"),
      routeDemand("documents:reconcile"),
      routeDemand("documents:assemble"),
    ],
    granted: ["documents:assemble"],
    allowlist: {},
    expect: ["ungranted-permission", "ungranted-permission"],
  },
];
