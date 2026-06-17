import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { ProtectedReadForbiddenError } from "@magna-carta/data-access/protected-fields";
import { assertPermission } from "@magna-carta/access-control/registry";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";
import {
  addIdentifier,
  findByIdentifier,
  IdentifierNotIndexableError,
  readIdentifier,
  type DirectoryIdentifierContext,
} from "../src/identifiers.ts";

// End-to-end exercise of the directory sensitive-identifier path over real SQLite and a real seeded
// firm key — write→match→read through the slice 1·2 protected-field chokepoint. The firm key is minted
// with encryption's generate+wrap and recovered through the committed firm-key provider, so the full
// envelope, AAD, HKDF derivation, and blind index are under test, not stubbed. The blind index is the
// conflicts exact-identifier channel: a formatted and an unformatted value collide; a decrypt requires
// the permission and writes an audit row; low-entropy types are never standalone-indexed.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");

const clock = { now: () => "2026-06-17T00:00:00.000Z" };

interface TestContext {
  readonly database: BatchDatabase;
  readonly raw: ReturnType<typeof createMigratedNodeDatabase>["raw"];
  readonly randomSource: ReturnType<typeof seededRandomSource>;
  readonly ctx: DirectoryIdentifierContext;
  readonly withoutPermission: DirectoryIdentifierContext;
}

async function directoryTestContext(seed: string): Promise<TestContext> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);

  function context(permissions: ReadonlySet<string>): DirectoryIdentifierContext {
    return {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider: provider,
      database,
      effectivePermissions: permissions as never,
      actorUserId: ACTOR,
      clock,
      randomSource,
    };
  }

  return {
    database,
    raw,
    randomSource,
    ctx: context(new Set([VIEW_SENSITIVE])),
    withoutPermission: context(new Set()),
  };
}

function decryptAuditCount(t: TestContext): number {
  const row = t.raw
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'protected.decrypt'")
    .get() as { n: number };
  return Number(row.n);
}

function identifierRow(
  t: TestContext,
  entityId: string,
  type: string,
): { value_ciphertext: string; value_blind_index: string | null } {
  return t.raw
    .prepare(
      "SELECT value_ciphertext, value_blind_index FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = ?2",
    )
    .get(entityId, type) as { value_ciphertext: string; value_blind_index: string | null };
}

test("an SSN round-trips through protected() and matches by blind index without decrypt", async () => {
  const t = await directoryTestContext("t9-ssn");
  const personId = await createPerson(
    t.database,
    { given: "Jane", family: "Roe" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, personId, { type: "ssn", value: "123-45-6789" });

  // The stored row holds ciphertext + a blind index only — never the plaintext.
  const stored = identifierRow(t, personId, "ssn");
  expect(stored.value_ciphertext).not.toContain("123456789");
  expect(stored.value_ciphertext).not.toContain("123-45-6789");
  expect(stored.value_blind_index).not.toBeNull();

  // Exact-match channel: a formatting-insensitive lookup finds the entity, with no decrypt audit.
  const hits = await findByIdentifier(t.ctx, { type: "ssn", value: "123456789" });
  expect(hits).toContain(personId);
  expect(decryptAuditCount(t)).toBe(0);

  // A different SSN does not match.
  const miss = await findByIdentifier(t.ctx, { type: "ssn", value: "987-65-4321" });
  expect(miss).not.toContain(personId);
  expect(decryptAuditCount(t)).toBe(0);

  // Reading the plaintext requires the permission and writes an audit row.
  const value = await readIdentifier(t.ctx, personId, "ssn");
  expect(value).toBe("123-45-6789");
  expect(decryptAuditCount(t)).toBe(1);
});

test("a read without the permission throws and writes no plaintext (and no audit)", async () => {
  const t = await directoryTestContext("t9-forbidden");
  const personId = await createPerson(
    t.database,
    { given: "Mallory", family: "Vance" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, personId, { type: "ssn", value: "555-66-7777" });

  await expect(readIdentifier(t.withoutPermission, personId, "ssn")).rejects.toBeInstanceOf(
    ProtectedReadForbiddenError,
  );
  await expect(readIdentifier(t.withoutPermission, personId, "ssn")).rejects.toThrow(/permission/);
  expect(decryptAuditCount(t)).toBe(0);
});

test("an EIN on an organization is standalone-indexed and matches formatting-insensitively", async () => {
  const t = await directoryTestContext("t9-ein");
  const organizationId = await createOrganization(
    t.database,
    { legalName: "Acme Holdings Pty Ltd" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, organizationId, { type: "ein", value: "12-3456789" });

  const stored = identifierRow(t, organizationId, "ein");
  expect(stored.value_blind_index).not.toBeNull();

  const hits = await findByIdentifier(t.ctx, { type: "ein", value: "123456789" });
  expect(hits).toContain(organizationId);
  expect(decryptAuditCount(t)).toBe(0);
});

test("DOB is stored protected but never standalone-indexed", async () => {
  const t = await directoryTestContext("t9-dob");
  const personId = await createPerson(
    t.database,
    { given: "Dana", family: "Okafor" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, personId, { type: "dob", value: "1980-01-02" });

  // Stored protected, but the blind-index column is NULL — no standalone exact-match channel.
  const stored = identifierRow(t, personId, "dob");
  expect(stored.value_ciphertext).not.toContain("1980-01-02");
  expect(stored.value_blind_index).toBeNull();

  // Matching a never-indexed type is refused with a named code — nothing to match against.
  await expect(
    findByIdentifier(t.ctx, { type: "dob", value: "1980-01-02" }),
  ).rejects.toBeInstanceOf(IdentifierNotIndexableError);
  await expect(findByIdentifier(t.ctx, { type: "dob", value: "1980-01-02" })).rejects.toThrow(
    /no-standalone-index/,
  );

  // But the value still decrypts with the permission (it is protected, just not indexed).
  expect(await readIdentifier(t.ctx, personId, "dob")).toBe("1980-01-02");
});

test("ssn_last_four is protected but never standalone-indexed", async () => {
  const t = await directoryTestContext("t9-last4");
  const personId = await createPerson(
    t.database,
    { given: "Ravi", family: "Singh" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, personId, { type: "ssn_last_four", value: "6789" });

  const stored = identifierRow(t, personId, "ssn_last_four");
  expect(stored.value_blind_index).toBeNull();
  await expect(
    findByIdentifier(t.ctx, { type: "ssn_last_four", value: "6789" }),
  ).rejects.toBeInstanceOf(IdentifierNotIndexableError);
});

test("addIdentifier writes a directory.identifier.added audit row in the same batch", async () => {
  const t = await directoryTestContext("t9-audit");
  const personId = await createPerson(
    t.database,
    { given: "Lee", family: "Park" },
    { clock, actorUserId: ACTOR, randomSource: t.randomSource },
  );
  await addIdentifier(t.ctx, personId, { type: "ssn", value: "111-22-3333" });

  const added = t.raw
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'directory.identifier.added'")
    .get() as { n: number };
  expect(Number(added.n)).toBe(1);
});
