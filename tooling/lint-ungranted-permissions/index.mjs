import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWLIST, SELF_TEST, findUngrantedPermissions } from "./rules.mjs";

// Fitness function: every permission that gates a member-facing surface is one some role can hold.
//
// A permission nobody can hold is a capability nobody can reach, and it is invisible from every
// direction that normally catches a defect — the route is registered, the chokepoint enforces it
// correctly, the registry declares it, and every test passes because each one inserts its own direct
// grant. The reasoning, the measurements and the two widenings that were tried and rejected are in
// rules.mjs.
//
// It is deliberately quiet: one rule, two demand sources, plus a per-permission allowlist whose
// entries each carry a written reason. On the tree it was built against it reports nothing — the one
// standing exception is on the list, and a list entry that stops being true is itself a failure.
//
// Run: `pnpm run lint:ungranted-permissions`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The committed OpenAPI snapshot, which is the machine-readable form of every route's RouteMeta:
// `defineOpenAPIRoute` writes `x-mc-permission` and `x-mc-surface` onto each operation, and a
// byte-exact test in apps/api-worker fails if the snapshot drifts from the code. Reading it beats
// parsing the TypeScript for a fact that is already committed in a shape with no ambiguity — and it
// is the only place `surface` and `permission` sit beside each other for every route at once.
const OPENAPI_SNAPSHOT = "apps/api-worker/openapi/openapi.json";

// The Tools catalogue: one manifest per tool, each naming the permission that decides whether a
// member sees it. `toolsByGroup`/`toolsFor` in packages/tools/src/select.ts filter on exactly this,
// so a manifest whose permission nobody holds is a tile nobody has ever seen.
const TOOLS_CATALOGUE = "packages/tools/src/catalog.ts";

// Where the seeds live. Both lineages, because a permission seeded anywhere is a permission somebody
// can hold.
const MIGRATION_ROOT = "packages/database/drizzle";

// The two tables a seed can put a permission into. Taken from the same pair
// packages/database/test/generated-migrations.test.ts holds its own seed fitness function over.
const PERMISSION_SEED_TABLES = ["role_permission", "direct_grant"];

// A chokepoint route whose surface is "public" is NOT a demand. The chokepoint
// (apps/api-worker/src/http/chokepoint/chokepoint.ts) skips its session, authn and RBAC steps entirely for a
// public surface — those routes carry their own header-token guard — so the `permission:` on one is
// nominal metadata and a role that held it would gain nothing. Counting them was measured at three
// false positives out of seven; see rules.mjs.
const ENFORCED_SURFACE = "app";

// Permissions each surface demands, as `{ permission, source, where }`. Pure over the file contents
// so a replay against an older commit can feed it the same shapes read out of git.
export function collectRouteDemands(openApiDocument) {
  const demands = [];
  for (const [path, item] of Object.entries(openApiDocument.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (typeof operation !== "object" || operation === null) continue;
      const permission = operation["x-mc-permission"];
      // `permission: null` is a route that names no capability — an authenticated read any member
      // may make. It demands nothing and this rule says nothing about it.
      if (typeof permission !== "string") continue;
      if (operation["x-mc-surface"] !== ENFORCED_SURFACE) continue;
      demands.push({
        permission,
        source: "route",
        where: `${method.toUpperCase()} ${path}`,
      });
    }
  }
  return demands;
}

const CATALOGUE_PERMISSION = /permission:\s*assertPermission\("([^"]+)"\)/g;

export function collectCatalogueDemands(catalogueSource) {
  CATALOGUE_PERMISSION.lastIndex = 0;
  const demands = [];
  let match;
  while ((match = CATALOGUE_PERMISSION.exec(catalogueSource)) !== null) {
    demands.push({ permission: match[1], source: "tools-catalogue", where: TOOLS_CATALOGUE });
  }
  return demands;
}

// One seed INSERT, drizzle backtick style, single-quoted literals — what every permission seed in
// this repository looks like. Column ORDER is not assumed: the columns are read off the statement
// and the `permission` value taken by name, so a seed written with its columns in another order is
// still counted rather than silently missed.
const SEED_INSERT = new RegExp(
  String.raw`INSERT\s+INTO\s+\x60(${PERMISSION_SEED_TABLES.join("|")})\x60\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)`,
  "gi",
);

export function collectGrants(sqlByPath) {
  const granted = new Set();
  for (const sql of sqlByPath.values()) {
    SEED_INSERT.lastIndex = 0;
    let match;
    while ((match = SEED_INSERT.exec(sql)) !== null) {
      const columns = match[2].split(",").map((column) => column.trim().replaceAll("`", ""));
      const values = match[3].split(",").map((value) => value.trim());
      const index = columns.indexOf("permission");
      if (index === -1) continue;
      const literal = /^'((?:[^']|'')*)'$/su.exec(values[index] ?? "");
      // A seed whose permission is not a plain literal — a SELECT, a parameter — cannot be read
      // statically, and treating it as "grants nothing" would be a false alarm rather than a miss.
      // Nothing in the repository writes one; if one appears it fails the vacuity guard below or
      // shows up as a hit that a reader can allowlist with the reason.
      if (literal === null) continue;
      granted.add((literal[1] ?? "").replaceAll("''", "'"));
    }
  }
  return granted;
}

function readMigrationSql(root) {
  const sqlByPath = new Map();
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".sql")) sqlByPath.set(path, readFileSync(path, "utf8"));
    }
  };
  walk(join(root, MIGRATION_ROOT));
  return sqlByPath;
}

// The gate's own rules, checked against their fixtures on every invocation, so a rule that stops
// biting fails here as well as in the suite.
export function runSelfTest() {
  const failures = [];
  for (const { name, demands, granted, allowlist, expect } of SELF_TEST) {
    const found = findUngrantedPermissions(
      demands,
      new Set(granted),
      new Map(Object.entries(allowlist)),
    )
      .map((problem) => problem.rule)
      .toSorted();
    const wanted = [...expect].toSorted();
    if (JSON.stringify(found) !== JSON.stringify(wanted)) {
      failures.push({ name, found, wanted });
    }
  }
  return failures;
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error(
      "\nlint-ungranted-permissions: the scan's own rule no longer does what it must.\n",
    );
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.wanted)}\n` +
          `    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const openApiDocument = JSON.parse(readFileSync(join(ROOT, OPENAPI_SNAPSHOT), "utf8"));
  const demands = [
    ...collectRouteDemands(openApiDocument),
    ...collectCatalogueDemands(readFileSync(join(ROOT, TOOLS_CATALOGUE), "utf8")),
  ];
  const granted = collectGrants(readMigrationSql(ROOT));

  // Vacuity guards. A scan that collected nothing passes trivially, which is exactly how a renamed
  // extension key or a moved migration directory turns a gate into a no-op nobody notices. Both
  // sides have to be non-empty for the comparison between them to mean anything.
  if (demands.length === 0) {
    console.error(
      "\nlint-ungranted-permissions: found no permission-gated surface at all — the OpenAPI" +
        " extension keys or the Tools catalogue shape have drifted.\n",
    );
    process.exit(1);
  }
  if (granted.size === 0) {
    console.error(
      "\nlint-ungranted-permissions: found no seeded permission at all — the seed INSERT shape or" +
        ` the ${MIGRATION_ROOT} layout has drifted.\n`,
    );
    process.exit(1);
  }

  const found = findUngrantedPermissions(demands, granted);

  if (found.length > 0) {
    console.error("\nPermissions gating a surface that no role can hold:\n");
    for (const problem of found) {
      const where =
        problem.where.length === 0
          ? "tooling/lint-ungranted-permissions/rules.mjs"
          : problem.where.join("\n          ");
      console.error(
        `  \`${problem.permission}\`  [${problem.rule}]\n      ${problem.detail}\n      ${where}`,
      );
    }
    console.error(
      `\n${found.length} problem(s) across ${new Set(demands.map((demand) => demand.permission)).size}` +
        ` permission-gated surface(s) and ${granted.size} seeded permission(s).` +
        "\nNothing writes role_permission or direct_grant at runtime, so a permission with no seed" +
        " is one no member of any firm can ever hold: the surface answers 403 to everybody and" +
        " looks exactly like a firm that configured it that way." +
        "\nSeed it in a per-firm migration, or add it to ALLOWLIST in" +
        " tooling/lint-ungranted-permissions/rules.mjs with the reason no role may carry it.",
    );
    process.exit(1);
  }

  console.log(
    `Every permission-gated surface is reachable (${new Set(demands.map((demand) => demand.permission)).size}` +
      ` permission(s) demanded across ${demands.length} surface(s), against ${granted.size} seeded);` +
      ` ${ALLOWLIST.size} allowlisted, each with its reason, and every one of those still has no seed.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
