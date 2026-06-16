import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { normalizeToDigits } from "@magna-carta/encryption/normalize";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import {
  createFirmKeyProvider,
  FirmKeyUnavailableError,
  type WrappedKeyRow,
} from "../src/firm-key-provider.ts";
import {
  blindIndexValue,
  composeProtectedWrite,
  protectedField,
  ProtectedReadForbiddenError,
  readProtected,
  type ProtectedReadContext,
} from "../src/protected-fields.ts";
import { incidentDescription } from "../src/protected-field-registry.ts";
import { getSecret, putSecret } from "../src/secret-statements.ts";
import { sqliteBatchDatabase } from "./support/sqlite-batch-database.ts";

// End-to-end exercise of the protected-field chokepoint over real SQLite and a real seeded firm key:
// write→read round-trip, the 403 no-audit path, blind-index match without a decrypt audit, crypto-shred
// fail-closed isolation between firms, and the secrets store. The firm key is minted with encryption's
// generate+wrap and recovered through the committed firm-key provider, so the full envelope, AAD, and
// HKDF derivation are under test, not stubbed.

// The fixed local-dev root KEK (base64), mirroring the .dev.vars placeholder.
const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";

const FIRM_A = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const FIRM_B = "firm_bbbbbbbbbbbbbbbbbbbbbb" as FirmId;
const ACTOR = "user_actor" as UserId;

const clock = { now: () => "2026-06-16T00:00:00.000Z" };
const randomSource = seededRandomSource("protected-fields-test");

// The permission set a reader holds in the round-trip / secrets happy paths.
const WITH_INCIDENT_PERMISSION = new Set([incidentDescription.permission]);
const WITHOUT_PERMISSION = new Set<never>();

// A synthetic SSN-like declaration — TEST ONLY, never shipped — for the blind-index path. It points at
// an in-test table; the registry conformance test guards the real, shipped declarations.
const syntheticSsn = protectedField({
  table: "synthetic_identifier",
  column: "ssn_ciphertext",
  purpose: "pii",
  permission: incidentDescription.permission, // any registered key; this path never checks it
  blindIndex: {
    name: "exact",
    normalize: normalizeToDigits,
    lengthBits: 16,
    column: "ssn_blind_index",
  },
});

function setupDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  // Column names mirror @magna-carta/database/per-firm-schema (guarded by the conformance + schema-name
  // tests); foreign keys omitted — parent rows are out of scope here.
  database.exec(
    `CREATE TABLE incident (
      id TEXT PRIMARY KEY,
      description_ciphertext TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE firm_secret (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      actor_user_id TEXT,
      subject_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE synthetic_identifier (
      id TEXT PRIMARY KEY,
      ssn_ciphertext TEXT NOT NULL,
      ssn_blind_index TEXT NOT NULL
    );`,
  );
  return database;
}

// A wrapped firm key per firm — distinct random keys, so a ciphertext sealed under one firm cannot be
// read by another (the crypto-shred / isolation property).
async function mintWrappedKeys(): Promise<Map<string, string>> {
  const rootKek = await importRootKek(ROOT_KEK);
  return new Map([
    [FIRM_A, await wrapFirmKey(rootKek, generateFirmKeyBytes())],
    [FIRM_B, await wrapFirmKey(rootKek, generateFirmKeyBytes())],
  ]);
}

interface Harness {
  database: ReturnType<typeof sqliteBatchDatabase>;
  raw: DatabaseSync;
  wrapped: Map<string, string | null>;
  provider: ReturnType<typeof createFirmKeyProvider>;
}

async function harness(): Promise<Harness> {
  const raw = setupDatabase();
  const wrapped = new Map<string, string | null>(await mintWrappedKeys());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> => {
      if (!wrapped.has(firmId)) return null;
      return { wrappedFirmKey: wrapped.get(firmId) ?? null, firmKeyVersion: 1 };
    },
  });
  return { database: sqliteBatchDatabase(raw), raw, wrapped, provider };
}

function readContext(
  h: Harness,
  firmId: FirmId,
  permissions: ReadonlySet<unknown>,
): ProtectedReadContext {
  return {
    firmId,
    firmKeyVersion: 1,
    firmKeyProvider: h.provider,
    database: h.database,
    effectivePermissions: permissions as never,
    actorUserId: ACTOR,
    clock,
    randomSource,
  };
}

function auditRows(
  raw: DatabaseSync,
): { event: string; subject_id: string | null; metadata: string | null }[] {
  return raw
    .prepare("SELECT event, subject_id, metadata FROM audit_log WHERE event = 'protected.decrypt'")
    .all() as never;
}

describe("protected-field chokepoint over real SQLite", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it("write→read round-trip: incident description seals on write and decrypts with the permission, writing the decrypt audit", async () => {
    const incidentId = "incident_round_trip";
    const plaintext = "Client slipped on the unmarked wet floor in the lobby.";
    const sealed = await composeProtectedWrite(
      readContext(h, FIRM_A, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      incidentId,
      plaintext,
    );
    expect(sealed.ciphertextValue).not.toContain(plaintext);
    h.raw
      .prepare("INSERT INTO incident (id, description_ciphertext, created_at) VALUES (?1, ?2, ?3)")
      .run(incidentId, sealed.ciphertextValue, clock.now());

    const row = h.raw
      .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
      .get(incidentId) as { description_ciphertext: string };
    const decrypted = await readProtected(
      readContext(h, FIRM_A, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      row,
      incidentId,
    );
    expect(decrypted).toBe(plaintext);

    const audits = auditRows(h.raw);
    expect(audits.length).toBe(1);
    expect(audits[0]?.subject_id).toBe(incidentId);
    // Metadata carries field identity ONLY — never the plaintext.
    expect(audits[0]?.metadata).toBe(
      JSON.stringify({ field: "description_ciphertext", table: "incident" }),
    );
    expect(audits[0]?.metadata).not.toContain(plaintext);
  });

  it("403: a read without the permission throws ProtectedReadForbiddenError, attempts no decrypt, and writes NO audit row", async () => {
    const incidentId = "incident_forbidden";
    const sealed = await composeProtectedWrite(
      readContext(h, FIRM_A, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      incidentId,
      "Privileged narrative.",
    );
    h.raw
      .prepare("INSERT INTO incident (id, description_ciphertext, created_at) VALUES (?1, ?2, ?3)")
      .run(incidentId, sealed.ciphertextValue, clock.now());
    const ciphertextBefore = h.raw
      .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
      .get(incidentId) as { description_ciphertext: string };

    await expect(
      readProtected(
        readContext(h, FIRM_A, WITHOUT_PERMISSION),
        incidentDescription,
        ciphertextBefore,
        incidentId,
      ),
    ).rejects.toBeInstanceOf(ProtectedReadForbiddenError);

    expect(auditRows(h.raw).length).toBe(0);
    const ciphertextAfter = h.raw
      .prepare("SELECT description_ciphertext FROM incident WHERE id = ?1")
      .get(incidentId) as { description_ciphertext: string };
    expect(ciphertextAfter.description_ciphertext).toBe(ciphertextBefore.description_ciphertext);
  });

  it("blind index: a formatted and an unformatted SSN yield the IDENTICAL index value, computed with no decrypt audit", async () => {
    const context = readContext(h, FIRM_A, WITHOUT_PERMISSION);
    const formatted = await blindIndexValue(context, syntheticSsn, "123-45-6789");
    const unformatted = await blindIndexValue(context, syntheticSsn, "123456789");
    expect(formatted).toBe(unformatted);
    expect(formatted.startsWith("1:")).toBe(true);
    // A different SSN gives a different value (the index is not constant).
    const other = await blindIndexValue(context, syntheticSsn, "987-65-4321");
    expect(other).not.toBe(formatted);
    // Computing a blind index never decrypts and never audits.
    expect(auditRows(h.raw).length).toBe(0);

    // And the write-side index value matches the lookup-side value, so a stored row is findable.
    const written = await composeProtectedWrite(
      context,
      syntheticSsn,
      "synthetic_row",
      "123-45-6789",
    );
    expect(written.blindIndexColumn).toBe("ssn_blind_index");
    expect(written.blindIndexValue).toBe(formatted);
  });

  it("crypto-shred: firm A reads fail closed after its key is nulled and the cache invalidated, while firm B still reads", async () => {
    const incidentId = "incident_shred";
    const plaintextA = "Firm A privileged description.";
    const plaintextB = "Firm B privileged description.";
    const sealedA = await composeProtectedWrite(
      readContext(h, FIRM_A, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      incidentId,
      plaintextA,
    );
    const sealedB = await composeProtectedWrite(
      readContext(h, FIRM_B, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      incidentId,
      plaintextB,
    );

    // Shred firm A: null its wrapped key and drop the cached handle (the same-isolate shred window).
    h.wrapped.set(FIRM_A, null);
    h.provider.invalidate(FIRM_A);

    await expect(
      readProtected(
        readContext(h, FIRM_A, WITH_INCIDENT_PERMISSION),
        incidentDescription,
        { description_ciphertext: sealedA.ciphertextValue },
        incidentId,
      ),
    ).rejects.toBeInstanceOf(FirmKeyUnavailableError);

    // Firm B (a different key) is unaffected.
    const decryptedB = await readProtected(
      readContext(h, FIRM_B, WITH_INCIDENT_PERMISSION),
      incidentDescription,
      { description_ciphertext: sealedB.ciphertextValue },
      incidentId,
    );
    expect(decryptedB).toBe(plaintextB);
  });

  it("secrets: putSecret→getSecret round-trips, getSecret audits, an absent name yields null with no audit, and no permission is forbidden", async () => {
    // getSecret gates on firm:manageSecrets — give the reader exactly that for the happy path.
    const manageSecrets = await import("@magna-carta/access-control/registry").then((m) =>
      m.assertPermission("firm:manageSecrets"),
    );
    const secretsContext = readContext(h, FIRM_A, new Set([manageSecrets]));

    await putSecret(
      {
        firmId: FIRM_A,
        firmKeyVersion: 1,
        firmKeyProvider: h.provider,
        database: h.database,
        clock,
      },
      "easypost.apiKey",
      "ezsk_live_secret_value",
    );
    const value = await getSecret(secretsContext, "easypost.apiKey");
    expect(value).toBe("ezsk_live_secret_value");
    // The stored row holds ciphertext only — never the plaintext.
    const stored = h.raw
      .prepare("SELECT ciphertext, created_at, updated_at FROM firm_secret WHERE name = ?1")
      .get("easypost.apiKey") as { ciphertext: string; created_at: string; updated_at: string };
    expect(stored.ciphertext).not.toContain("ezsk_live_secret_value");

    // getSecret writes a decrypt audit row.
    expect(auditRows(h.raw).length).toBe(1);

    // An absent name: null, NO audit.
    const missing = await getSecret(secretsContext, "no.such.secret");
    expect(missing).toBeNull();
    expect(auditRows(h.raw).length).toBe(1); // unchanged — a miss is not a read

    // No permission: forbidden whether or not the name exists.
    await expect(
      getSecret(readContext(h, FIRM_A, WITHOUT_PERMISSION), "easypost.apiKey"),
    ).rejects.toBeInstanceOf(ProtectedReadForbiddenError);
    await expect(
      getSecret(readContext(h, FIRM_A, WITHOUT_PERMISSION), "no.such.secret"),
    ).rejects.toBeInstanceOf(ProtectedReadForbiddenError);
  });

  it("secrets: a second putSecret for the same name updates the value, moves updated_at, and keeps created_at", async () => {
    const manageSecrets = await import("@magna-carta/access-control/registry").then((m) =>
      m.assertPermission("firm:manageSecrets"),
    );
    const secretsContext = readContext(h, FIRM_A, new Set([manageSecrets]));
    const writeContext = {
      firmId: FIRM_A,
      firmKeyVersion: 1,
      firmKeyProvider: h.provider,
      database: h.database,
    };

    await putSecret(
      { ...writeContext, clock: { now: () => "2026-06-16T00:00:00.000Z" } },
      "k",
      "v1",
    );
    const first = h.raw
      .prepare("SELECT id, created_at, updated_at FROM firm_secret WHERE name = 'k'")
      .get() as {
      id: string;
      created_at: string;
      updated_at: string;
    };
    await putSecret(
      { ...writeContext, clock: { now: () => "2026-06-17T00:00:00.000Z" } },
      "k",
      "v2",
    );
    const second = h.raw
      .prepare("SELECT id, created_at, updated_at FROM firm_secret WHERE name = 'k'")
      .get() as {
      id: string;
      created_at: string;
      updated_at: string;
    };

    expect(second.id).toBe(first.id); // same row id — so the AAD-bound ciphertext stays decryptable
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at).toBe("2026-06-17T00:00:00.000Z");
    expect(await getSecret(secretsContext, "k")).toBe("v2");
  });
});
