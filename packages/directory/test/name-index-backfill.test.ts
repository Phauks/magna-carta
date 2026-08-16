import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { assertPermission } from "@magna-carta/access-control/registry";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";
import { type DirectoryIdentifierContext } from "../src/identifiers.ts";
import { assertDirectoryFitness, findNamesMissingDerivedMatchingData } from "../src/fitness.ts";
import {
  countNamesAwaitingIndexBackfill,
  runNameIndexBackfillPass,
} from "../src/name-index-backfill.ts";

// The corpus a firm already holds predates the match keys and the phonemes, and until the sweep has
// reached it every one of those names is invisible to channels a check will report as having run.
// The sweep therefore has to finish, and — because it runs inside a scheduled invocation with a
// budget — it has to be able to stop halfway and be resumed without a stored cursor.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");
const clock = { now: () => "2026-08-16T00:00:00.000Z" };

async function harness(seed: string): Promise<DirectoryIdentifierContext> {
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
    database,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource: seededRandomSource(seed),
  };
}

// Strip the derived keys off every name row, reproducing the state a firm's database is in the
// instant the migration lands: the columns exist and hold nothing for a name written before them.
async function stripDerivedData(database: BatchDatabase): Promise<void> {
  await database
    .prepare(
      `UPDATE directory_name SET normalized_match_key = NULL, normalized_match_key_bare = NULL`,
    )
    .run();
}

async function seedNames(context: DirectoryIdentifierContext, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await createPerson(
      context.database,
      { given: `Given${index}`, family: `Kowalczyk${index}` },
      context,
    );
  }
  await createOrganization(context.database, { legalName: "Smith & Jones LLP" }, context);
}

test("a live write needs no backfill at all — the sweep is only for what predates it", async () => {
  const context = await harness("backfill-live");
  await seedNames(context, 3);
  expect(await countNamesAwaitingIndexBackfill(context.database)).toBe(0);
  await expect(assertDirectoryFitness(context.database)).resolves.toBeUndefined();
});

test("the sweep is resumable and budgeted: a bounded pass leaves the rest still selected", async () => {
  const context = await harness("backfill-resume");
  await seedNames(context, 7);
  await stripDerivedData(context.database);

  // Seven persons plus the organization.
  expect(await countNamesAwaitingIndexBackfill(context.database)).toBe(8);

  // A pass smaller than the outstanding work reports that it did not finish, rather than looping
  // until it is killed. Falling behind is a fact the caller can see.
  const first = await runNameIndexBackfillPass(context.database, { batchSize: 3 });
  expect(first.moreRemaining).toBe(true);
  expect(first.matchKeysFilled).toBe(3);
  expect(await countNamesAwaitingIndexBackfill(context.database)).toBe(5);

  // Resuming needs no stored cursor: the selection predicate IS the outstanding work, so the next
  // pass simply finds a smaller set. Drive it to completion the way the cron pass would.
  let passes = 1;
  while ((await runNameIndexBackfillPass(context.database, { batchSize: 3 })).moreRemaining) {
    passes += 1;
    expect(passes).toBeLessThan(10);
  }
  expect(await countNamesAwaitingIndexBackfill(context.database)).toBe(0);
  await expect(assertDirectoryFitness(context.database)).resolves.toBeUndefined();
});

test("a finished sweep is a no-op, and re-running it writes nothing", async () => {
  const context = await harness("backfill-idempotent");
  await seedNames(context, 2);
  await stripDerivedData(context.database);
  while ((await runNameIndexBackfillPass(context.database, { batchSize: 50 })).moreRemaining) {
    /* drain */
  }
  const again = await runNameIndexBackfillPass(context.database, { batchSize: 50 });
  expect(again).toEqual({ matchKeysFilled: 0, moreRemaining: false });
});

test("a backfilled row carries exactly what a freshly written one carries", async () => {
  // The sweep recomputes from the stored columns rather than from the display string, so a name
  // written before the derivation and a name written after it must be indistinguishable — otherwise
  // the corpus holds two populations and a channel matches one of them.
  const context = await harness("backfill-parity");
  await createPerson(context.database, { given: "Anna", family: "Kowalczyk" }, context);
  const live = await derivedDataFor(context.database);

  await stripDerivedData(context.database);
  while ((await runNameIndexBackfillPass(context.database, { batchSize: 50 })).moreRemaining) {
    /* drain */
  }
  expect(await derivedDataFor(context.database)).toEqual(live);
});

test("the fitness probe reports the outstanding rows while the sweep has not run", async () => {
  const context = await harness("backfill-fitness");
  await seedNames(context, 2);
  await stripDerivedData(context.database);
  const outstanding = await findNamesMissingDerivedMatchingData(context.database);
  expect(outstanding.length).toBe(3);
  expect(outstanding.every((row) => row.missing === "match_keys")).toBe(true);
  await expect(assertDirectoryFitness(context.database)).rejects.toThrow(
    /missing derived matching data/,
  );
});

async function derivedDataFor(database: BatchDatabase): Promise<unknown[]> {
  const { results } = await database
    .prepare(
      `SELECT id, normalized_match_key, normalized_match_key_bare FROM directory_name ORDER BY id ASC`,
    )
    .all();
  return results;
}
