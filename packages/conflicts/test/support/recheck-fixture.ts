import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";

// The shared fixture for the re-check tests: a migrated per-firm database with a member, real firm
// key material (the identifier channels need it), and a context shaped exactly as the automated path
// builds one — no actor, no capability. Reproduced rather than imported from the worker so the
// package's own tests do not depend on the composition root.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
export const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
export const ACTOR = "user_actor" as UserId;

export interface RecheckFixture {
  readonly database: BatchDatabase;
  readonly raw: { exec(sql: string): void };
  readonly context: DirectoryIdentifierContext;
  readonly clock: { now(): string };
  readonly randomSource: ReturnType<typeof seededRandomSource>;
  readonly writeOptions: {
    clock: { now(): string };
    actorUserId: UserId;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
  // Inserts a live matter and returns its id. Matters are seeded raw: what these tests are about is
  // which ledger rows a corpus change produces, not how a matter comes to exist.
  addMatter(id: string, status?: "consultation" | "open" | "closed"): void;
}

export async function recheckFixture(
  seed: string,
  now = "2026-08-13T09:00:00.000Z",
): Promise<RecheckFixture> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const clock = { now: () => now };
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${now}')`,
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
    clock,
    randomSource,
    context: {
      firmId: FIRM,
      firmKeyVersion: 1,
      firmKeyProvider,
      database: batchDatabase,
      // Empty, exactly as an automated run holds: nobody is behind it, so it carries no capability.
      effectivePermissions: new Set(),
      actorUserId: null,
      clock,
      randomSource,
    },
    writeOptions: { clock, actorUserId: ACTOR, randomSource },
    addMatter(id, status = "open") {
      raw.exec(
        `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES ('${id}', 'Matter ${id}', '${status}', '${ACTOR}', '${now}', '${now}')`,
      );
    },
  };
}
