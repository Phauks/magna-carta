import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { describe, expect, it } from "vitest";

// The append-only guarantee is the TRIGGER'S, not the service's, so it is asserted at the database
// with raw SQL. A service-level test would only prove that the service did not try — which is worth
// nothing against a future call site, a migration, or a hand-run repair that does.

function migratedDatabase() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  return { database, raw };
}

const MOVEMENT_COLUMNS =
  "id, packet_id, item_id, kind, occurred_at, recorded_at, recorded_by_user_id, from_location_id, to_location_id, borrower_kind, borrower_user_id, borrower_entity_id, borrower_name, due_back_on, reason, corrects_movement_id, shipment_id, note";

// A packet the movement can hang off. Inserted with raw SQL so this file depends on the schema and
// the triggers alone, never on the services.
function seedPacket(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(`
    INSERT INTO custody_location (id, name, kind, status, created_at, updated_at)
      VALUES ('custodyLocation_seed000000000000000', 'Reno safe', 'safe', 'active', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
    INSERT INTO custody_packet (id, custody_number, number_source, name, current_location_id, status, created_at, updated_at)
      VALUES ('custodyPacket_seed0000000000000000', 'CUS-00001', 'drawn', 'Smith family deeds', 'custodyLocation_seed000000000000000', 'held', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
    INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
      VALUES ('custodyMovement_seed00000000000000', 'custodyPacket_seed0000000000000000', NULL, 'logged', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL, NULL, 'custodyLocation_seed000000000000000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
}

describe("custody_movement is append-only at the database", () => {
  it("refuses an UPDATE", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `UPDATE custody_movement SET kind = 'returned' WHERE id = 'custodyMovement_seed00000000000000'`,
      ),
    ).toThrow(/custody_movement is append-only/);
  });

  it("refuses a DELETE", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(`DELETE FROM custody_movement WHERE id = 'custodyMovement_seed00000000000000'`),
    ).toThrow(/custody_movement is append-only/);
  });

  // REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the delete or update
  // triggers, so without the BEFORE INSERT guard this would overwrite a ledger row in place — the
  // one remaining path that could mutate an append-only record. The kind is a plain move because
  // several BEFORE INSERT triggers now sit on this table and SQLite does not order them: a kind that
  // any other guard would also refuse would leave which one fired to chance.
  it("refuses an INSERT OR REPLACE onto an existing row", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT OR REPLACE INTO custody_movement (${MOVEMENT_COLUMNS})
           VALUES ('custodyMovement_seed00000000000000', 'custodyPacket_seed0000000000000000', NULL, 'moved', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ),
    ).toThrow(/custody_movement is append-only/);
  });

  it("still accepts an ordinary append", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    raw.exec(
      `INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
         VALUES ('custodyMovement_second000000000000', 'custodyPacket_seed0000000000000000', NULL, 'moved', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, 'custodyLocation_seed000000000000000', 'custodyLocation_seed000000000000000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    );
    const rows = raw.prepare(`SELECT COUNT(*) AS total FROM custody_movement`).all() as {
      total: number;
    }[];
    expect(rows[0]?.total).toBe(2);
  });

  // The ledger table was rebuilt to widen its kind vocabulary — SQLite can only replace a CHECK
  // constraint that way — so the guarantee has to be re-proved on the table that came out of the
  // rebuild, not only on the one that went in. These are the three assertions above, plus the two
  // below that say the rebuild neither lost the old vocabulary nor left the new one out.
  it("accepts a review as a movement kind", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    raw.exec(
      `INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
         VALUES ('custodyMovement_reviewed0000000000', 'custodyPacket_seed0000000000000000', NULL, 'reviewed', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    );
    const rows = raw
      .prepare(`SELECT kind FROM custody_movement WHERE id = 'custodyMovement_reviewed0000000000'`)
      .all() as { kind: string }[];
    expect(rows[0]?.kind).toBe("reviewed");
  });

  it("still refuses a movement kind outside the vocabulary", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
           VALUES ('custodyMovement_invented0000000000', 'custodyPacket_seed0000000000000000', NULL, 'shredded', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ),
    ).toThrow(/custody_movement_kind_check/);
  });
});

// The release gate is a TRIGGER and not a CHECK, so that releases recorded before it existed stay as
// they were recorded rather than being made to pass a rule nobody applied at the time. That choice is
// only defensible if the trigger really binds every row appended from here on, so it is asserted at
// the database with raw SQL for the same reason the append-only guarantee is.
describe("a release cannot be appended without its authority and identity capture", () => {
  const RELEASE_COLUMNS = `${MOVEMENT_COLUMNS}, release_authority_basis, release_identity_evidence, release_identity_verified_by_user_id, release_witnessed_by_user_id`;
  const RELEASE_PREFIX = `'custodyPacket_seed0000000000000000', NULL, 'released', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, 'custodyLocation_seed000000000000000', NULL, 'external', NULL, NULL, 'A. Collector', NULL, NULL, NULL, NULL, NULL`;

  function insertRelease(
    raw: ReturnType<typeof migratedDatabase>["raw"],
    id: string,
    capture: string,
  ): void {
    raw.exec(
      `INSERT INTO custody_movement (${RELEASE_COLUMNS}) VALUES ('${id}', ${RELEASE_PREFIX}, ${capture})`,
    );
  }

  it("refuses a release that records no authority at all", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(raw, "custodyMovement_bare0000000000000", "NULL, NULL, NULL, NULL"),
    ).toThrow(/records the authority relied on and the identity check/);
  });

  it("refuses a release whose authority is blank rather than absent", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_blank000000000000",
        "'   ', 'passport checked', 'user_verifier00000000000000', NULL",
      ),
    ).toThrow(/records the authority relied on and the identity check/);
  });

  it("refuses a release that names no member as having checked identity", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_noChecker00000000",
        "'grant of probate', 'passport checked', NULL, NULL",
      ),
    ).toThrow(/records the authority relied on and the identity check/);
  });

  it("refuses a witnessed release whose two signatories are the same person", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_sameSigner0000000",
        "'grant of probate', 'passport checked', 'user_verifier00000000000000', 'user_verifier00000000000000'",
      ),
    ).toThrow(/two different people/);
  });

  it("refuses release capture hung on a movement that is not a release", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_movement (${RELEASE_COLUMNS})
           VALUES ('custodyMovement_wrongKind0000000', 'custodyPacket_seed0000000000000000', NULL, 'moved', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, NULL, 'custodyLocation_seed000000000000000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'grant of probate', 'passport checked', 'user_verifier00000000000000', NULL)`,
      ),
    ).toThrow(/belongs only to a released movement/);
  });

  it("accepts a release that carries the whole capture", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    insertRelease(
      raw,
      "custodyMovement_authorized0000000",
      "'grant of probate dated 3 March', 'passport checked against the Directory record', 'user_verifier00000000000000', 'user_witness000000000000000'",
    );
    const rows = raw
      .prepare(
        `SELECT release_authority_basis FROM custody_movement WHERE id = 'custodyMovement_authorized0000000'`,
      )
      .all() as { release_authority_basis: string }[];
    expect(rows[0]?.release_authority_basis).toBe("grant of probate dated 3 March");
  });

  // The gate binds what is appended from now on and says nothing about what came before, which is the
  // whole reason it is a trigger. A release recorded under the old rules is still readable, still
  // correct, and still the truth about what happened.
  it("leaves a release recorded before the gate existed exactly as it was", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    raw.exec(
      `INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
         VALUES ('custodyMovement_historic000000000', 'custodyPacket_seed0000000000000000', NULL, 'checked_out', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, 'custodyLocation_seed000000000000000', NULL, 'external', NULL, NULL, 'A. Collector', NULL, NULL, NULL, NULL, NULL)`,
    );
    const rows = raw
      .prepare(
        `SELECT release_authority_basis FROM custody_movement WHERE id = 'custodyMovement_historic000000000'`,
      )
      .all() as { release_authority_basis: string | null }[];
    expect(rows[0]?.release_authority_basis).toBeNull();
  });
});

describe("the custody schema landed with the register's structural constraints", () => {
  it("refuses a review interval of zero months", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    // Zero is refused rather than read as "no cycle": reading it as null would let a typo silently
    // disable a recurring review, which is exactly the failure the review date exists to prevent.
    expect(() =>
      raw.exec(
        `UPDATE custody_packet SET review_interval_months = 0 WHERE id = 'custodyPacket_seed0000000000000000'`,
      ),
    ).toThrow(/custody_packet_review_interval_check/);
  });

  it("refuses a check-out that names a borrower kind with no borrower", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_movement (${MOVEMENT_COLUMNS})
           VALUES ('custodyMovement_noBorrower00000000', 'custodyPacket_seed0000000000000000', NULL, 'checked_out', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, NULL, NULL, 'external', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      ),
    ).toThrow(/custody_movement_borrower_shape_check/);
  });

  it("refuses a declared value with no currency", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_item (id, packet_id, ordinal, description, intrinsic_value, declared_value_amount_minor, status, created_at, updated_at)
           VALUES ('custodyItem_noCurrency000000000000', 'custodyPacket_seed0000000000000000', 1, 'A ring', 0, 400000, 'held', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
      ),
    ).toThrow(/custody_item_declared_value_check/);
  });

  it("refuses a mid-tree location that claims a firm office", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_location (id, name, kind, parent_location_id, firm_location_id, status, created_at, updated_at)
           VALUES ('custodyLocation_child00000000000000', 'Top shelf', 'shelf', 'custodyLocation_seed000000000000000', 'location_someOffice0000000000', 'active', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
      ),
    ).toThrow(/custody_location_firm_binding_check/);
  });

  it("seeds the item-type catalog with intrinsic-value defaults", () => {
    const { raw } = migratedDatabase();
    const rows = raw
      .prepare(
        `SELECT name, intrinsic_value_default FROM custody_item_type WHERE code IN ('WILL', 'KEYS') ORDER BY code`,
      )
      .all() as { name: string; intrinsic_value_default: number }[];
    expect(rows).toEqual([
      { name: "Keys", intrinsic_value_default: 0 },
      { name: "Original will", intrinsic_value_default: 1 },
    ]);
  });

  it("seeds both custody permissions onto the roles that need them", () => {
    const { raw } = migratedDatabase();
    const rows = raw
      .prepare(
        `SELECT permission, COUNT(*) AS roles FROM role_permission WHERE permission LIKE 'custody:%' GROUP BY permission ORDER BY permission`,
      )
      .all() as { permission: string; roles: number }[];
    // Reading the register is broad (every default role); moving originals in it is not.
    expect(rows).toEqual([
      { permission: "custody:manage", roles: 3 },
      { permission: "custody:read", roles: 5 },
    ]);
  });
});
