import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { createEdge } from "../src/edges.ts";
import { addIdentifier, type DirectoryIdentifierContext } from "../src/identifiers.ts";
import { mergeEntities } from "../src/merge.ts";
import { changeName } from "../src/name-history.ts";
import { createOrganization } from "../src/organization.ts";
import { linkMatterParty } from "../src/party.ts";
import { createPerson } from "../src/person.ts";
import {
  DIRECTORY_EDGE_CREATED_TOPIC,
  DIRECTORY_ENTITY_CREATED_TOPIC,
  DIRECTORY_ENTITY_MERGED_TOPIC,
  DIRECTORY_ENTITY_RENAMED_TOPIC,
  DIRECTORY_IDENTIFIER_ADDED_TOPIC,
  DIRECTORY_OUTBOX_TOPICS,
  MATTER_PARTY_LINKED_TOPIC,
} from "../src/topics.ts";

// EVERY WRITE PATH THAT CAN CHANGE AN ALREADY-ANSWERED CONFLICTS QUESTION ANNOUNCES ITSELF, ONCE, IN
// THE BATCH IT WAS ALREADY COMPOSING.
//
// Two properties are load-bearing and neither is visible from reading a call site:
//
//   * EXACTLY ONE row per write. A second would double the write amplification of every party link
//     and every merge; none at all would silently stop the whole automatic re-check path, because an
//     unrecognized (or absent) topic on the per-firm bus is acked and ignored by design.
//   * NONE when the write fails. The outbox row and the business rows share one atomic batch, so a
//     refused write must leave no announcement behind — otherwise a consumer resolves matters for a
//     merge that never happened.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const MATTER = "matter_topics";
const clock = { now: () => "2026-08-13T09:00:00.000Z" };

interface Fixture {
  readonly database: BatchDatabase;
  readonly raw: { exec(sql: string): void };
  readonly context: DirectoryIdentifierContext;
  readonly options: {
    clock: typeof clock;
    actorUserId: UserId;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
}

async function fixture(seed: string): Promise<Fixture> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES ('${MATTER}', 'Topic matter', 'open', '${ACTOR}', '${clock.now()}', '${clock.now()}')`,
  );
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const firmKeyProvider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);
  const batchDatabase = database as unknown as BatchDatabase;
  return {
    database: batchDatabase,
    raw,
    context: {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider,
      database: batchDatabase,
      effectivePermissions: new Set(),
      actorUserId: ACTOR,
      clock,
      randomSource,
    },
    options: { clock, actorUserId: ACTOR, randomSource },
  };
}

async function outboxRows(
  database: BatchDatabase,
  topic: string,
): Promise<Array<{ payload: string }>> {
  const { results } = await database
    .prepare("SELECT payload FROM outbox WHERE topic = ?1")
    .bind(topic)
    .all<{ payload: string }>();
  return results;
}

async function outboxTotal(database: BatchDatabase): Promise<number> {
  const { results } = await database
    .prepare("SELECT COUNT(*) AS total FROM outbox")
    .all<{ total: number }>();
  return results[0]?.total ?? 0;
}

test("every announced topic is a member of the frozen set", () => {
  // The set exists so a producer and a subscriber cannot come to spell one topic two ways. A constant
  // that is not in the set would defeat that by being importable and unenumerable at once.
  expect([...DIRECTORY_OUTBOX_TOPICS]).toEqual([
    DIRECTORY_ENTITY_CREATED_TOPIC,
    DIRECTORY_ENTITY_RENAMED_TOPIC,
    DIRECTORY_ENTITY_MERGED_TOPIC,
    DIRECTORY_EDGE_CREATED_TOPIC,
    DIRECTORY_IDENTIFIER_ADDED_TOPIC,
    MATTER_PARTY_LINKED_TOPIC,
  ]);
});

test("linkMatterParty commits exactly one matter_party.linked row naming the matter and entity", async () => {
  const { database, options } = await fixture("party-link");
  const entityId = await createPerson(database, { given: "Ada", family: "Byron" }, options);
  await linkMatterParty(database, { matterId: MATTER, entityId, role: "client" }, options);

  const rows = await outboxRows(database, MATTER_PARTY_LINKED_TOPIC);
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toMatchObject({ matterId: MATTER, entityId });
});

test("createEdge commits exactly one directory.edge.created row naming both endpoints and the type", async () => {
  const { database, options } = await fixture("edge-create");
  const from = await createOrganization(database, { legalName: "Acme Holdings" }, options);
  const to = await createOrganization(database, { legalName: "Acme Trading" }, options);
  await createEdge(
    database,
    {
      from,
      to,
      edgeType: "corporate_parent",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const rows = await outboxRows(database, DIRECTORY_EDGE_CREATED_TOPIC);
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toMatchObject({
    fromEntityId: from,
    toEntityId: to,
    edgeType: "corporate_parent",
  });
});

test("mergeEntities commits exactly one directory.entity.merged row naming master AND subordinate", async () => {
  const { database, context, options } = await fixture("merge");
  const masterId = await createPerson(database, { given: "Ada", family: "Byron" }, options);
  const subordinateId = await createPerson(database, { given: "Ada", family: "Byron" }, options);
  await mergeEntities(
    { ...context, idempotency: undefined },
    { masterId, subordinateId, survivorship: {} },
  );

  const rows = await outboxRows(database, DIRECTORY_ENTITY_MERGED_TOPIC);
  expect(rows).toHaveLength(1);
  // Both sides, because a matter that named only the archived record is exactly the one whose answer
  // the merge could have changed, and only the pair identifies it.
  expect(JSON.parse(rows[0]!.payload)).toMatchObject({ masterId, subordinateId });
});

test("addIdentifier announces the entity and the TYPE, and never a value or a blind index", async () => {
  const { database, context, options } = await fixture("identifier");
  const entityId = await createPerson(database, { given: "Ada", family: "Byron" }, options);
  await addIdentifier({ ...context, idempotency: undefined }, entityId, {
    type: "ssn",
    value: "123-45-6789",
  });

  const rows = await outboxRows(database, DIRECTORY_IDENTIFIER_ADDED_TOPIC);
  expect(rows).toHaveLength(1);
  const payload = rows[0]!.payload;
  expect(JSON.parse(payload)).toMatchObject({ entityId, identifierType: "ssn" });
  // A blind index is a stable fingerprint of the plaintext. Neither it nor the digits may ride a
  // relayed message: anything reading the bus could otherwise correlate a person without decrypting.
  expect(payload).not.toContain("123");
  expect(payload).not.toContain("6789");
  expect(payload.toLowerCase()).not.toContain("blind");
});

test("changeName announces the renamed entity once", async () => {
  const { database, options } = await fixture("rename");
  const entityId = await createPerson(database, { given: "Ada", family: "Byron" }, options);
  await changeName(database, entityId, { given: "Ada", family: "Lovelace" }, options);

  const rows = await outboxRows(database, DIRECTORY_ENTITY_RENAMED_TOPIC);
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0]!.payload)).toMatchObject({ entityId });
});

test("a refused write leaves no announcement behind", async () => {
  const { database, options } = await fixture("refused");
  const before = await outboxTotal(database);
  // A party link against an entity that does not exist fails before the batch is composed. The
  // announcement and the business rows share one commit, so nothing may survive the refusal — a
  // stray row here would send a consumer resolving matters for a link that was never made.
  await expect(
    linkMatterParty(
      database,
      { matterId: MATTER, entityId: "directoryPerson_missing", role: "client" },
      options,
    ),
  ).rejects.toThrow();
  expect(await outboxTotal(database)).toBe(before);
});
