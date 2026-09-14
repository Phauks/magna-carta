/*
 * Writing the firm's conflicts floor.
 *
 * The property under test is not "the value round-trips" — it is that WHAT IS STORED IS WHAT RUNS.
 * The read has always repaired an unsound stored policy on the way out (party unioned back into the
 * floor, `current` back into the name roles, caps clamped), which is right for a value the platform
 * did not write. The moment a screen can write one, that repair becomes a trap: an administrator who
 * deselects every source would store `[]`, be shown `[]` on reload, and be looking at a floor the
 * platform would never run. So the write normalizes through the same function and stores the result,
 * and these tests pin that — by reading the RAW setting row, not just the value the read hands back,
 * because a read that repairs would make a broken write look correct.
 */
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import type { ConflictsWriteOptions } from "../src/audit.ts";
import {
  DEFAULT_CONFLICTS_POLICY,
  normalizeConflictsPolicy,
  readConflictsPolicy,
  resolveScope,
  writeConflictsPolicy,
  type ConflictsPolicy,
} from "../src/settings.ts";

const ACTOR = "user_actor" as UserId;
const clock = { now: () => "2026-09-07T00:00:00.000Z" };

function fixture(seed: string) {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const options: ConflictsWriteOptions = {
    clock,
    actorUserId: ACTOR,
    randomSource: seededRandomSource(seed),
  };
  return { database, raw, options };
}

/** The setting row exactly as it sits on disk, with no read-side repair between it and the test. */
function storedPolicyRow(raw: { prepare(sql: string): { get(key: string): unknown } }): unknown {
  const row = raw.prepare(`SELECT value FROM setting WHERE key = ?`).get("conflicts.policy") as
    | { value: string }
    | undefined;
  return row === undefined ? undefined : JSON.parse(row.value);
}

test("a sound policy is stored verbatim and read back unchanged", async () => {
  const { database, raw, options } = fixture("policy-verbatim");
  const asked: ConflictsPolicy = {
    floorSources: ["party", "graph", "imputation"],
    floorStrictness: "over_inclusive",
    balancedNameRoles: ["current", "former", "maiden", "alias"],
  };

  const stored = await writeConflictsPolicy(database, asked, options);

  // Name roles come back SORTED — parseBalancedNameRoles canonicalizes them, so the set is the
  // value and the order is not. Everything else is stored exactly as asked.
  expect({ ...stored, balancedNameRoles: [] }).toEqual({ ...asked, balancedNameRoles: [] });
  expect([...stored.balancedNameRoles].toSorted()).toEqual([...asked.balancedNameRoles].toSorted());
  expect(storedPolicyRow(raw)).toEqual(stored);
  await expect(readConflictsPolicy(database)).resolves.toEqual(stored);
});

test("a floor with every source deselected stores the party class, not an empty list", async () => {
  const { database, raw, options } = fixture("policy-empty-floor");

  const stored = await writeConflictsPolicy(
    database,
    { ...DEFAULT_CONFLICTS_POLICY, floorSources: [] },
    options,
  );

  // The whole point: the ROW carries party. A read-side union would hide a stored `[]` behind a
  // correct-looking answer, and the screen re-reading the row would then show an empty floor.
  expect(stored.floorSources).toEqual(["party"]);
  expect((storedPolicyRow(raw) as ConflictsPolicy).floorSources).toEqual(["party"]);
});

test("the current name role is stored back in even when a caller drops it", async () => {
  const { database, raw, options } = fixture("policy-name-roles");

  const stored = await writeConflictsPolicy(
    database,
    { ...DEFAULT_CONFLICTS_POLICY, balancedNameRoles: ["former", "maiden"] },
    options,
  );

  expect(stored.balancedNameRoles).toContain("current");
  expect((storedPolicyRow(raw) as ConflictsPolicy).balancedNameRoles).toContain("current");
});

test("a stored policy written under the old bounds reads past them, and the next save drops them", async () => {
  // A row from before 2026-09-11 carries a default depth, hop budgets and two caps. None of them is
  // a setting any more: the walk follows relationships to closure and the bound on a run is the
  // platform's. The read ignores them rather than honouring them, and a save stores the three fields
  // that are still the firm's to decide.
  const { database, raw, options } = fixture("policy-old-bounds");
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', ` +
      `'{"floorSources":["party","graph"],"floorStrictness":"balanced","defaultDepth":3,"edgeClassBudgets":{"control":3},"closureCap":250,"candidateCap":120,"balancedNameRoles":["current"]}', ` +
      `'2026-09-01T00:00:00.000Z')`,
  );
  const read = await readConflictsPolicy(database);
  expect(read).toEqual({
    floorSources: ["party", "graph"],
    floorStrictness: "balanced",
    balancedNameRoles: ["current"],
  });

  const stored = await writeConflictsPolicy(database, read, options);
  expect(Object.keys(storedPolicyRow(raw) as object).toSorted()).toEqual([
    "balancedNameRoles",
    "floorSources",
    "floorStrictness",
  ]);
  expect(stored).toEqual(read);
});

test("an empty request stores the shipped default rather than a policy of holes", async () => {
  // Every field optional on the wire means an omitted one is "use the default", never "leave the
  // previous value" — the floor is one value written whole, so a half-empty body must not compose a
  // floor out of two different administrators' intentions.
  const { database, options } = fixture("policy-empty");

  const stored = await writeConflictsPolicy(database, {}, options);

  // Compared as a SET on the name roles, for the reason above: the shipped default constant lists
  // them in the order its comment reasons about (current, former, maiden, alias) and the normalizer
  // canonicalizes to sorted order. The two are the same policy, and nothing reads the order.
  expect({ ...stored, balancedNameRoles: [] }).toEqual({
    ...DEFAULT_CONFLICTS_POLICY,
    balancedNameRoles: [],
  });
  expect([...stored.balancedNameRoles].toSorted()).toEqual(
    [...DEFAULT_CONFLICTS_POLICY.balancedNameRoles].toSorted(),
  );
});

test("what is written is what resolveScope then holds a check to", async () => {
  // The end-to-end claim the screen rests on: a floor saved here raises a narrower request made
  // later. Without this the two halves could agree on storage and still disagree on meaning.
  const { database, options } = fixture("policy-in-force");
  await writeConflictsPolicy(
    database,
    {
      ...DEFAULT_CONFLICTS_POLICY,
      floorSources: ["party", "graph"],
      floorStrictness: "over_inclusive",
    },
    options,
  );

  const inForce = await readConflictsPolicy(database);
  const resolved = resolveScope(inForce, { sources: ["party"], strictness: "balanced" });

  expect(resolved.sources).toEqual(["party", "graph"]);
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.floorRaised).toBe(true);
});

test("the change is on the firm's audit log, naming who made it", async () => {
  // Nothing else records that a firm narrowed what it searches: no check row says a person chose
  // this, so the audit row is the only place the decision has a name on it.
  const { database, raw, options } = fixture("policy-audit");
  await writeConflictsPolicy(database, DEFAULT_CONFLICTS_POLICY, options);

  const rows = raw
    .prepare(`SELECT event, subject_id, actor_user_id FROM audit_log WHERE event = ?`)
    .all("conflicts.policy.changed") as unknown as ReadonlyArray<{
    event: string;
    subject_id: string;
    actor_user_id: string | null;
  }>;

  expect(rows).toHaveLength(1);
  expect(rows[0]?.subject_id).toBe("conflicts.policy");
  expect(rows[0]?.actor_user_id).toBe(ACTOR);
});

test("normalization is one function, so the write cannot drift from the read's repairs", () => {
  // A structural guard rather than a behavioural one: if someone reimplements either side, this is
  // the assertion that stops the two answering the same unsound policy differently.
  const unsound = {
    floorSources: [],
    balancedNameRoles: [],
  } as unknown as Partial<ConflictsPolicy>;
  const once = normalizeConflictsPolicy(unsound);
  expect(normalizeConflictsPolicy(once)).toEqual(once);
});
