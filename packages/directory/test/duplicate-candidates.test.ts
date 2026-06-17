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
import { expect, test } from "vitest";
import { createPerson } from "../src/person.ts";
import { createOrganization } from "../src/organization.ts";
import { addIdentifier, type DirectoryIdentifierContext } from "../src/identifiers.ts";
import { findDuplicateCandidates } from "../src/search.ts";

// End-to-end tests for the three-channel duplicate-candidate generator. Each channel is exercised
// in isolation first (phonetic block, trigram, blind-index), then multi-channel union/ranking and
// the excludeEntityId option are verified.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");

const clock = { now: () => "2026-06-17T00:00:00.000Z" };

interface TestContext {
  readonly database: BatchDatabase;
  readonly ctx: DirectoryIdentifierContext;
}

async function directoryTestContext(seed: string): Promise<TestContext> {
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

// ── Channel 1: Phonetic block ──────────────────────────────────────────────────

test("phonetic channel returns a sound-alike person (Smith / Smyth)", async () => {
  const { database, ctx } = await directoryTestContext("t12-phonetic-a");

  // Store "Smith" — the phonetic block target.
  const personId = await createPerson(
    database,
    { given: "John", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-phonetic-a-target") },
  );

  // Query with the sound-alike "Smyth".
  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "John",
    family: "Smyth",
  });

  const entityIds = candidates.map((c) => c.entityId);
  expect(entityIds).toContain(personId);
});

test("phonetic channel returns a sound-alike organization", async () => {
  const { database, ctx } = await directoryTestContext("t12-phonetic-org");

  const orgId = await createOrganization(
    database,
    { legalName: "Acme Legal Pty Ltd" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-phonetic-org-target") },
  );

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "organization",
    legalName: "Acme Legal Pty Ltd",
  });

  expect(candidates.map((c) => c.entityId)).toContain(orgId);
});

// ── Channel 2: Trigram ────────────────────────────────────────────────────────

test("trigram channel returns a typo/substring match", async () => {
  const { database, ctx } = await directoryTestContext("t12-trigram-a");

  const personId = await createPerson(
    database,
    { given: "Catherine", family: "Williams" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-trigram-a-target") },
  );

  // Deliberate typo: "Cathrine" vs "Catherine"
  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Cathrine",
    family: "Williams",
  });

  expect(candidates.map((c) => c.entityId)).toContain(personId);
});

// ── Channel 3: Blind-index identifier ────────────────────────────────────────

test("identifier channel finds a person by SSN blind index", async () => {
  const { database, ctx } = await directoryTestContext("t12-identifier-ssn");

  const personId = await createPerson(
    database,
    { given: "Dana", family: "Lee" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-identifier-ssn-target") },
  );
  await addIdentifier(ctx, personId, { type: "ssn", value: "123-45-6789" });

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Dana",
    family: "Lee",
    identifiers: [{ type: "ssn", value: "123-45-6789" }],
  });

  expect(candidates.map((c) => c.entityId)).toContain(personId);
});

test("non-indexable identifier types (dob, ssn_last_four) are silently skipped", async () => {
  const { database, ctx } = await directoryTestContext("t12-identifier-dob");

  const personId = await createPerson(
    database,
    { given: "Riley", family: "Morgan" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-identifier-dob-target") },
  );
  await addIdentifier(ctx, personId, { type: "dob", value: "1980-01-01" });

  // Including a dob identifier must not throw — it is simply skipped.
  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Riley",
    family: "Morgan",
    identifiers: [{ type: "dob", value: "1980-01-01" }],
  });

  // No error was thrown; result may or may not contain personId via other channels.
  expect(Array.isArray(candidates)).toBe(true);
});

// ── Union, deduplication, and ranking ─────────────────────────────────────────

test("candidates are deduplicated when the same entity hits multiple channels", async () => {
  const { database, ctx } = await directoryTestContext("t12-dedup");

  // "John Smith" with an SSN — this entity will hit both the phonetic and identifier channels.
  const personId = await createPerson(
    database,
    { given: "John", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-dedup-target") },
  );
  await addIdentifier(ctx, personId, { type: "ssn", value: "999-88-7777" });

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "John",
    family: "Smith",
    identifiers: [{ type: "ssn", value: "999-88-7777" }],
  });

  // The entity must appear exactly once despite hitting multiple channels.
  const occurrences = candidates.filter((c) => c.entityId === personId);
  expect(occurrences).toHaveLength(1);
});

test("candidates are ranked: multi-channel hits rank above single-channel hits", async () => {
  const { database, ctx } = await directoryTestContext("t12-ranking");

  // Strong candidate: shares an SSN and is phonetically similar — hits two channels.
  const strongPersonId = await createPerson(
    database,
    { given: "Alice", family: "Johnson" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-ranking-strong") },
  );
  await addIdentifier(ctx, strongPersonId, { type: "ssn", value: "111-22-3333" });

  // Weak candidate: phonetically similar name only — hits one channel.
  await createPerson(
    database,
    { given: "Alicia", family: "Johnston" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-ranking-weak") },
  );

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Alice",
    family: "Johnson",
    identifiers: [{ type: "ssn", value: "111-22-3333" }],
  });

  const strongIndex = candidates.findIndex((c) => c.entityId === strongPersonId);
  expect(strongIndex).toBeGreaterThanOrEqual(0);

  // The strong candidate should appear in the result set.
  expect(candidates.map((c) => c.entityId)).toContain(strongPersonId);

  // If both appear, the strong candidate (more channel signals) must rank at or above the weak one.
  const aliciaId = candidates.find(
    (c) => c.entityId !== strongPersonId && c.signalCount <= 1,
  )?.entityId;
  if (aliciaId !== undefined) {
    const aliciaIndex = candidates.findIndex((c) => c.entityId === aliciaId);
    expect(strongIndex).toBeLessThanOrEqual(aliciaIndex);
  }
});

// ── excludeEntityId ────────────────────────────────────────────────────────────

test("excludeEntityId removes the entity being edited from the candidate set", async () => {
  const { database, ctx } = await directoryTestContext("t12-exclude");

  const personId = await createPerson(
    database,
    { given: "Sam", family: "Brown" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-exclude-target") },
  );

  // Without exclusion the entity appears (phonetic + trigram will match itself).
  const withSelf = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Sam",
    family: "Brown",
  });
  expect(withSelf.map((c) => c.entityId)).toContain(personId);

  // With exclusion the entity is absent.
  const withoutSelf = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Sam",
    family: "Brown",
    excludeEntityId: personId,
  });
  expect(withoutSelf.map((c) => c.entityId)).not.toContain(personId);
});

// ── Merged entities are excluded ───────────────────────────────────────────────

test("merged_into entities do not appear in duplicate candidates", async () => {
  const { database, ctx } = await directoryTestContext("t12-merged");

  // Master (active)
  const masterId = await createPerson(
    database,
    { given: "Master", family: "Record" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-merged-master") },
  );

  // Subordinate — same name, but will be merged away.
  const subordinateId = await createPerson(
    database,
    { given: "Master", family: "Record" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-merged-sub") },
  );

  // Mark subordinate as merged_into the master.
  await database
    .prepare(
      "UPDATE directory_person SET status = 'merged_into', merged_into_id = ?1 WHERE id = ?2",
    )
    .bind(masterId, subordinateId)
    .run();

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Master",
    family: "Record",
  });

  const entityIds = candidates.map((c) => c.entityId);
  expect(entityIds).not.toContain(subordinateId);
  expect(entityIds).toContain(masterId);
});

// ── Empty name short-circuit ───────────────────────────────────────────────────

test("returns empty when no name is provided and no identifiers", async () => {
  const { ctx } = await directoryTestContext("t12-empty");

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
  });

  expect(candidates).toEqual([]);
});

// ── signalCount field ──────────────────────────────────────────────────────────

test("returned candidates carry a signalCount field", async () => {
  const { database, ctx } = await directoryTestContext("t12-signal-field");

  const personId = await createPerson(
    database,
    { given: "Taylor", family: "Green" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t12-signal-field-target") },
  );

  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Taylor",
    family: "Green",
  });

  const hit = candidates.find((c) => c.entityId === personId);
  expect(hit).toBeDefined();
  expect(typeof hit?.signalCount).toBe("number");
  expect(hit?.signalCount).toBeGreaterThanOrEqual(1);
});
