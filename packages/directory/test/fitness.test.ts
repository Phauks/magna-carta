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
import { beforeEach, describe, expect, it } from "vitest";
import { createPerson } from "../src/person.ts";
import { createEdge } from "../src/edges.ts";
import { mergeEntities } from "../src/merge.ts";
import { type DirectoryIdentifierContext } from "../src/identifiers.ts";
import {
  assertDirectoryFitness,
  DirectoryFitnessError,
  findEdgesToDeletedEntities,
  findNamesMissingPhonetics,
} from "../src/fitness.ts";

// Fitness function: the table-wide directory invariant audit. assertDirectoryFitness sweeps the corpus
// and proves three invariants hold — every live name carries both Double Metaphone codes, no live edge
// endpoint points at a soft-deleted entity, and no inbound reference points at a merged-away
// subordinate. Each probe is driven both ways: a sound corpus passes, and a single seeded violation
// fails with the offending row named.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

interface Harness {
  readonly database: BatchDatabase;
  readonly ctx: DirectoryIdentifierContext;
  readonly options: {
    clock: typeof clock;
    actorUserId: UserId;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
}

async function harness(seed: string): Promise<Harness> {
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
  return { database, ctx, options: { clock, actorUserId: ACTOR, randomSource } };
}

async function nameIdFor(database: BatchDatabase, entityId: string): Promise<string> {
  const { results } = await database
    .prepare(`SELECT id FROM directory_name WHERE entity_id = ?1`)
    .bind(entityId)
    .all<{ id: string }>();
  return results[0]?.id ?? "";
}

let h: Harness;
beforeEach(async () => {
  h = await harness("fitness-seed");
});

describe("assertDirectoryFitness — Double Metaphone coverage", () => {
  it("passes when every live name has both Double Metaphone codes", async () => {
    await createPerson(h.database, { given: "Catherine", family: "Smith" }, h.options);
    await createPerson(h.database, { given: "Robert", family: "Jones" }, h.options);

    // createPerson seeds both double_metaphone_primary and double_metaphone_secondary rows per name.
    expect(await findNamesMissingPhonetics(h.database)).toEqual([]);
    await expect(assertDirectoryFitness(h.database)).resolves.toBeUndefined();
  });

  it("flags a name missing the secondary Double Metaphone code", async () => {
    const personId = await createPerson(
      h.database,
      { given: "Catherine", family: "Smith" },
      h.options,
    );
    // Find the name row, then drop ONE scheme code — the kind of gap a partial encode would leave.
    const nameId = await nameIdFor(h.database, personId);
    await h.database
      .prepare(
        `DELETE FROM directory_name_phonetic_code WHERE name_id = ?1 AND scheme = 'double_metaphone_secondary'`,
      )
      .bind(nameId)
      .run();

    const missing = await findNamesMissingPhonetics(h.database);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toEqual({
      nameId,
      missingSchemes: ["double_metaphone_secondary"],
    });
    await expect(assertDirectoryFitness(h.database)).rejects.toThrow(DirectoryFitnessError);
  });

  it("ignores a soft-deleted name that lost its codes", async () => {
    const personId = await createPerson(
      h.database,
      { given: "Catherine", family: "Smith" },
      h.options,
    );
    const nameId = await nameIdFor(h.database, personId);
    await h.database
      .prepare(`UPDATE directory_name SET deleted_at = ?2 WHERE id = ?1`)
      .bind(nameId, clock.now())
      .run();
    await h.database
      .prepare(`DELETE FROM directory_name_phonetic_code WHERE name_id = ?1`)
      .bind(nameId)
      .run();

    // An archived name is out of the corpus — its missing codes do not break fitness.
    expect(await findNamesMissingPhonetics(h.database)).toEqual([]);
    await expect(assertDirectoryFitness(h.database)).resolves.toBeUndefined();
  });
});

describe("assertDirectoryFitness — no edge to a soft-deleted entity", () => {
  it("passes when both edge endpoints are live", async () => {
    const a = await createPerson(h.database, { given: "Alice", family: "Anderson" }, h.options);
    const b = await createPerson(h.database, { given: "Bob", family: "Brown" }, h.options);
    await createEdge(
      h.database,
      {
        from: a,
        to: b,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      h.options,
    );

    expect(await findEdgesToDeletedEntities(h.database)).toEqual([]);
    await expect(assertDirectoryFitness(h.database)).resolves.toBeUndefined();
  });

  it("flags an edge whose target entity was soft-deleted", async () => {
    const a = await createPerson(h.database, { given: "Alice", family: "Anderson" }, h.options);
    const b = await createPerson(h.database, { given: "Bob", family: "Brown" }, h.options);
    await createEdge(
      h.database,
      {
        from: a,
        to: b,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      h.options,
    );

    // Soft-delete the target but leave the live edge dangling at it.
    await h.database
      .prepare(`UPDATE directory_person SET deleted_at = ?2 WHERE id = ?1`)
      .bind(b, clock.now())
      .run();

    const dangling = await findEdgesToDeletedEntities(h.database);
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({ column: "to_entity_id", entityId: b });
    await expect(assertDirectoryFitness(h.database)).rejects.toThrow(/soft-deleted entity/);
  });
});

describe("assertDirectoryFitness — no inbound reference to a merged subordinate", () => {
  it("passes after a complete merge (every inbound reference repointed)", async () => {
    const master = await createPerson(h.database, { given: "Jon", family: "Snow" }, h.options);
    const subordinate = await createPerson(
      h.database,
      { given: "Jonn", family: "Snow" },
      h.options,
    );
    const other = await createPerson(h.database, { given: "Sam", family: "Tarly" }, h.options);
    // An edge into the subordinate, which the merge must repoint to the master.
    await createEdge(
      h.database,
      {
        from: other,
        to: subordinate,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      h.options,
    );

    await mergeEntities(h.ctx, { masterId: master, subordinateId: subordinate, survivorship: {} });

    // A complete merge leaves no inbound reference at the subordinate, and the still-alive subordinate
    // name rows keep their phonetic codes — fitness passes whole.
    await expect(assertDirectoryFitness(h.database)).resolves.toBeUndefined();
  });

  it("flags an inbound reference left pointing at a merged subordinate", async () => {
    const master = await createPerson(h.database, { given: "Jon", family: "Snow" }, h.options);
    const subordinate = await createPerson(
      h.database,
      { given: "Jonn", family: "Snow" },
      h.options,
    );
    // Archive the subordinate as merged_into WITHOUT repointing an inbound edge — simulate a partial
    // merge that left a dangling pointer.
    await h.database
      .prepare(
        `UPDATE directory_person SET status = 'merged_into', merged_into_id = ?2 WHERE id = ?1`,
      )
      .bind(subordinate, master)
      .run();
    const other = await createPerson(h.database, { given: "Sam", family: "Tarly" }, h.options);
    await createEdge(
      h.database,
      {
        from: other,
        to: subordinate,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      h.options,
    );

    await expect(assertDirectoryFitness(h.database)).rejects.toThrow(/merged subordinate/);
  });
});
