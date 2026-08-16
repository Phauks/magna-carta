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
import { createOrganization } from "@magna-carta/directory/organization";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { expect, test } from "vitest";
import { assignTier, describeEvidence } from "../src/evidence.ts";
import { matchParty } from "../src/matching.ts";

// The name half of search depth, end to end over a real migrated corpus. Each channel is driven to a
// hit AND to the absence of one, because a channel that cannot miss is a channel that is not
// comparing anything, and a channel that never fires is coverage a firm can read and cannot rely on.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");
const clock = { now: () => "2026-08-16T00:00:00.000Z" };

async function context(seed: string): Promise<DirectoryIdentifierContext> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  return {
    firmId: FIRM,
    firmKeyVersion: 1,
    firmKeyProvider: createFirmKeyProvider({
      rootKekBase64: ROOT_KEK,
      readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
        firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
    }),
    database: database as unknown as BatchDatabase,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource: seededRandomSource(seed),
  };
}

test("one firm written two ways is a tier-2 match, on the match key", async () => {
  const ctx = await context("match-key-tier");
  const stored = await createOrganization(
    ctx.database,
    { legalName: "Smith and Jones, L.L.P." },
    ctx,
  );

  const matches = await matchParty(
    ctx,
    { kind: "organization", legalName: "Smith & Jones LLP", displayName: "Smith & Jones LLP" },
    "balanced",
  );

  const hit = matches.find((match) => match.entityId === stored);
  expect(hit).toBeDefined();
  // The frozen normalization does NOT join these two, which is the whole reason the key exists — so
  // the tier-2 statement is the match key's and not the exact-name probe's.
  expect(hit?.evidence.exactNormalizedName).toBe(false);
  expect(hit?.evidence.matchKeyName).toBe(true);
  expect(assignTier(hit!.evidence)).toBe(2);
  expect(describeEvidence(hit!.evidence)).toContain(
    "same name, different spelling of the legal form",
  );
});

test("the same name under a different legal form reaches tier 3 and not tier 2", async () => {
  const ctx = await context("bare-key-tier");
  const partnership = await createOrganization(
    ctx.database,
    { legalName: "Smith & Jones LLP" },
    ctx,
  );

  const matches = await matchParty(
    ctx,
    { kind: "organization", legalName: "Smith & Jones LLC", displayName: "Smith & Jones LLC" },
    "balanced",
  );

  const hit = matches.find((match) => match.entityId === partnership);
  expect(hit).toBeDefined();
  // A partnership and a limited company are different legal persons until somebody establishes
  // otherwise. The engine raises the question; it does not answer it by promoting the tier.
  expect(hit?.evidence.matchKeyName).toBe(false);
  expect(hit?.evidence.exactNormalizedName).toBe(false);
  expect(hit?.evidence.bareMatchKeyName).toBe(true);
  expect(assignTier(hit!.evidence)).toBe(3);
  expect(describeEvidence(hit!.evidence)).toContain("same name, different legal form");
});

test("the match key does not join two organizations that merely share a word", async () => {
  const ctx = await context("match-key-negative");
  const unrelated = await createOrganization(
    ctx.database,
    { legalName: "Jones Excavating LLP" },
    ctx,
  );
  const matches = await matchParty(
    ctx,
    { kind: "organization", legalName: "Smith & Jones LLP", displayName: "Smith & Jones LLP" },
    "balanced",
  );
  const hit = matches.find((match) => match.entityId === unrelated);
  // Trigram overlap may well surface it — nothing is ever suppressed — but neither key may claim it.
  expect(hit?.evidence.matchKeyName ?? false).toBe(false);
  expect(hit?.evidence.bareMatchKeyName ?? false).toBe(false);
});

test("the new channels are additive: a hit surfaces even when no fuzzy channel returned it", async () => {
  // The fuzzy channels can miss an exact agreement — a name shorter than a trigram has no trigrams —
  // so a key equality has to be able to surface a candidate on its own. Dropping a tier-2 signal
  // because it was not ALSO fuzzy would suppress a real hit.
  const ctx = await context("additive");
  const stored = await createOrganization(ctx.database, { legalName: "Oy & Oy Ltd" }, ctx);
  const matches = await matchParty(
    ctx,
    { kind: "organization", legalName: "Oy and Oy Limited", displayName: "Oy and Oy Limited" },
    "balanced",
  );
  const hit = matches.find((match) => match.entityId === stored);
  expect(hit?.evidence.matchKeyName).toBe(true);
  expect(assignTier(hit!.evidence)).toBe(2);
});

test("over-inclusive stays a strict superset once every new channel is enabled", async () => {
  const ctx = await context("superset-with-new-channels");
  await createOrganization(ctx.database, { legalName: "Smith and Jones, L.L.P." }, ctx);
  await createOrganization(ctx.database, { legalName: "Smith & Jones LLC" }, ctx);

  for (const subject of [
    { kind: "organization", legalName: "Smith & Jones LLP", displayName: "Smith & Jones LLP" },
    { kind: "person", given: "Catherine", family: "Smith" },
  ] as const) {
    const balanced = await matchParty(ctx, subject, "balanced");
    const wide = await matchParty(ctx, subject, "over_inclusive");
    const wideIds = new Set(wide.map((match) => match.entityId));
    for (const match of balanced) expect(wideIds.has(match.entityId)).toBe(true);
    expect(wide.length).toBeGreaterThanOrEqual(balanced.length);
  }
});
