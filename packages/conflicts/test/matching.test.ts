import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertPermission } from "@magna-carta/access-control/registry";
import { createPerson } from "@magna-carta/directory/person";
import { addName } from "@magna-carta/directory/name-history";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { expect, test } from "vitest";
import { matchOptionsFor, matchParty } from "../src/matching.ts";
import { DEFAULT_BALANCED_NAME_ROLES } from "../src/settings.ts";

// The exact-name probe and the directory channels both need a full DirectoryIdentifierContext
// (firm key material, effective permissions, clock, seeded randomness) — reproduced here from
// packages/directory/test/duplicate-candidates.test.ts so this package does not depend on
// directory's test sources.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");

const clock = { now: () => "2026-07-09T00:00:00.000Z" };

interface TestContext {
  readonly database: BatchDatabase;
  readonly ctx: DirectoryIdentifierContext;
}

async function conflictsTestContext(seed: string): Promise<TestContext> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);

  const ctx: DirectoryIdentifierContext = {
    firmId: FIRM,
    firmKeyVersion: 1,
    firmKeyProvider: provider,
    database,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource,
  };

  return { database, ctx };
}

test("balanced restricts to the primary metaphone scheme and the firm's name-role set", () => {
  const options = matchOptionsFor("balanced");
  expect(options.schemes).toEqual(["double_metaphone_primary"]);
  // The shipped default searches a party's previously-held names, so a married-name change is not
  // invisible at the default band. It is a SETTING rather than a constant, which the next test proves.
  expect(options.nameRoles).toEqual(DEFAULT_BALANCED_NAME_ROLES);
  expect(options.nameRoles).toContain("maiden");
});

test("the balanced name-role set is a setting: a narrower firm policy narrows the band", () => {
  const narrowed = matchOptionsFor("balanced", { nameRoles: ["current"] });
  expect(narrowed.nameRoles).toEqual(["current"]);
  // Widening the balanced band cannot break the superset relationship, because over-inclusive is the
  // one band a firm cannot configure: it always searches every role.
  expect(matchOptionsFor("over_inclusive", { nameRoles: ["current"] }).nameRoles).toBeUndefined();
});

test("over_inclusive restricts nothing, so it is a strict superset of balanced", () => {
  const options = matchOptionsFor("over_inclusive");
  expect(options.schemes).toBeUndefined();
  expect(options.nameRoles).toBeUndefined();
});

test("over_inclusive returns a superset of balanced for the same corpus", async () => {
  const { ctx } = await conflictsTestContext("superset");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);
  // `traded` carries "Smith" only under a `dba` name row, which the shipped balanced role set does
  // not include and over-inclusive does — a trading style is not a name a person previously held.
  const traded = await createPerson(ctx.database, { given: "Mary", family: "Jones" }, ctx);
  await addName(ctx.database, traded, { given: "Mary", family: "Smith", nameRole: "dba" }, ctx);

  const balanced = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "balanced",
  );
  const wide = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "over_inclusive",
  );

  const wideIds = new Set(wide.map((match) => match.entityId));
  for (const match of balanced) {
    expect(wideIds.has(match.entityId)).toBe(true);
  }
  expect(wide.length).toBeGreaterThanOrEqual(balanced.length);
  expect(wide.length).toBeGreaterThan(balanced.length);
});

test("an exact normalized-name match is reported as such", async () => {
  const { ctx } = await conflictsTestContext("exact-name");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);

  const matches = await matchParty(
    ctx,
    { kind: "person", given: "Catherine", family: "Smith" },
    "balanced",
  );
  expect(matches[0]?.evidence.exactNormalizedName).toBe(true);
});

test("the exact-name probe respects the resolved name-role set, not the strictness word", async () => {
  const { ctx } = await conflictsTestContext("exact-name-scope");
  // The entity's CURRENT name shares nothing with the query; only its FORMER name is an exact match.
  const renamed = await createPerson(ctx.database, { given: "Zeta", family: "Quorum" }, ctx);
  await addName(
    ctx.database,
    renamed,
    { given: "Common", family: "Name", nameRole: "former" },
    ctx,
  );

  const balanced = await matchParty(
    ctx,
    { kind: "person", given: "Common", family: "Name" },
    "balanced",
  );
  const wide = await matchParty(
    ctx,
    { kind: "person", given: "Common", family: "Name" },
    "over_inclusive",
  );

  // The shipped default searches previously-held names at the balanced band, so the person who
  // changed their name IS surfaced there — the miss this default exists to close.
  expect(balanced.find((match) => match.entityId === renamed)?.evidence.exactNormalizedName).toBe(
    true,
  );
  // Over-inclusive searches every name role, so it surfaces the entity too, flagged the same way.
  const wideHit = wide.find((match) => match.entityId === renamed);
  expect(wideHit?.evidence.exactNormalizedName).toBe(true);

  // And a firm that configures the narrow reading gets it: the same probe over the same corpus, with
  // the name-role set the only thing changed, stops surfacing the former name. That is the whole of
  // what answering the name-role breadth question costs — a setting, never a release.
  const narrow = await matchParty(
    ctx,
    { kind: "person", given: "Common", family: "Name" },
    "balanced",
    { nameRoles: ["current"] },
  );
  expect(narrow.some((match) => match.entityId === renamed)).toBe(false);
});

test("a weak trigram-only match still appears at every strictness", async () => {
  const { ctx } = await conflictsTestContext("no-suppression");
  await createPerson(ctx.database, { given: "Bartholomew", family: "Cathermore" }, ctx);

  for (const strictness of ["balanced", "over_inclusive"] as const) {
    const matches = await matchParty(
      ctx,
      { kind: "person", given: "Cather", family: "More" },
      strictness,
    );
    // Nothing is ever suppressed by tier — a weak candidate is surfaced, not dropped.
    expect(matches.length).toBeGreaterThan(0);
  }
});

test("trigram matching turned off drops a trigram-only match at balanced, never at over-inclusive", async () => {
  const { ctx } = await conflictsTestContext("trigram-off");
  await createPerson(ctx.database, { given: "Bartholomew", family: "Cathermore" }, ctx);
  const subject = { kind: "person" as const, given: "Cather", family: "More" };

  const without = await matchParty(ctx, subject, "balanced", { trigramMatching: false });
  expect(without.some((match) => match.evidence.trigramMatch)).toBe(false);

  // The over-inclusive band ignores the choice, so it still finds at least what balanced with
  // trigram matching on finds.
  const overInclusive = await matchParty(ctx, subject, "over_inclusive", {
    trigramMatching: false,
  });
  expect(overInclusive.length).toBeGreaterThan(0);
  expect(matchOptionsFor("over_inclusive", { trigramMatching: false })).toEqual({});
  expect(matchOptionsFor("balanced", { trigramMatching: false }).trigram).toBe(false);
});
