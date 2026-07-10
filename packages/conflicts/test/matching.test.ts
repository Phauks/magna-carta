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

test("balanced restricts to the primary metaphone scheme and current names", () => {
  const options = matchOptionsFor("balanced");
  expect(options.schemes).toEqual(["double_metaphone_primary"]);
  expect(options.nameRoles).toEqual(["current"]);
});

test("over_inclusive restricts nothing, so it is a strict superset of balanced", () => {
  const options = matchOptionsFor("over_inclusive");
  expect(options.schemes).toBeUndefined();
  expect(options.nameRoles).toBeUndefined();
});

test("over_inclusive returns a superset of balanced for the same corpus", async () => {
  const { ctx } = await conflictsTestContext("superset");
  await createPerson(ctx.database, { given: "Catherine", family: "Smith" }, ctx);
  // renamed carries "Smith" only as a former alias — balanced's nameRoles:["current"] restriction
  // hides it, while over_inclusive (no restriction) searches every name role and surfaces it.
  const renamed = await createPerson(ctx.database, { given: "Mary", family: "Jones" }, ctx);
  await addName(ctx.database, renamed, { given: "Mary", family: "Smith", nameRole: "former" }, ctx);

  const balanced = await matchParty(ctx, { kind: "person", given: "Catherine", family: "Smith" }, "balanced");
  const wide = await matchParty(ctx, { kind: "person", given: "Catherine", family: "Smith" }, "over_inclusive");

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

  const matches = await matchParty(ctx, { kind: "person", given: "Catherine", family: "Smith" }, "balanced");
  expect(matches[0]?.evidence.exactNormalizedName).toBe(true);
});

test("a weak trigram-only match still appears at every strictness", async () => {
  const { ctx } = await conflictsTestContext("no-suppression");
  await createPerson(ctx.database, { given: "Bartholomew", family: "Cathermore" }, ctx);

  for (const strictness of ["balanced", "over_inclusive"] as const) {
    const matches = await matchParty(ctx, { kind: "person", given: "Cather", family: "More" }, strictness);
    // Nothing is ever suppressed by tier — a weak candidate is surfaced, not dropped.
    expect(matches.length).toBeGreaterThan(0);
  }
});
