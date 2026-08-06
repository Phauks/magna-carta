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

// The people a release names. The signatory triggers read the firm's own member roster, so the
// roster is part of the fixture: an active member who records releases, an active colleague who
// witnesses one, and a member who has left — whose handle is well formed and whose witness signature
// is refused precisely because it names somebody who could not have stood at the safe.
const RECORDER = "user_verifier00000000000000";
const WITNESS = "user_witness000000000000000";
const DEPARTED = "user_departed00000000000000";
const STRANGER = "user_notAMember00000000000";

// A packet the movement can hang off. Inserted with raw SQL so this file depends on the schema and
// the triggers alone, never on the services.
function seedPacket(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  raw.exec(`
    INSERT INTO member (user_id, display_name, status, created_at)
      VALUES ('${RECORDER}', 'R. Ecorder', 'active', '2026-08-01T00:00:00.000Z');
    INSERT INTO member (user_id, display_name, status, created_at)
      VALUES ('${WITNESS}', 'W. Itness', 'active', '2026-08-01T00:00:00.000Z');
    INSERT INTO member (user_id, display_name, status, created_at)
      VALUES ('${DEPARTED}', 'D. Eparted', 'deactivated', '2026-08-01T00:00:00.000Z');
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
  const RELEASE_PREFIX = `'custodyPacket_seed0000000000000000', NULL, 'released', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', '${RECORDER}', 'custodyLocation_seed000000000000000', NULL, 'external', NULL, NULL, 'A. Collector', NULL, NULL, NULL, NULL, NULL`;

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
        `'   ', 'passport checked', '${RECORDER}', NULL`,
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
        `'grant of probate', 'passport checked', '${RECORDER}', '${RECORDER}'`,
      ),
    ).toThrow(/two different people/);
  });

  it("refuses release capture hung on a movement that is not a release", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_movement (${RELEASE_COLUMNS})
           VALUES ('custodyMovement_wrongKind0000000', 'custodyPacket_seed0000000000000000', NULL, 'moved', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', NULL, NULL, 'custodyLocation_seed000000000000000', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'grant of probate', 'passport checked', '${RECORDER}', NULL)`,
      ),
    ).toThrow(/belongs only to a released movement/);
  });

  it("accepts a release that carries the whole capture", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    insertRelease(
      raw,
      "custodyMovement_authorized0000000",
      `'grant of probate dated 3 March', 'passport checked against the Directory record', '${RECORDER}', '${WITNESS}'`,
    );
    const rows = raw
      .prepare(
        `SELECT release_authority_basis FROM custody_movement WHERE id = 'custodyMovement_authorized0000000'`,
      )
      .all() as { release_authority_basis: string }[];
    expect(rows[0]?.release_authority_basis).toBe("grant of probate dated 3 March");
  });

  // The identity check is an assertion about something the RECORDING member did. A row naming
  // somebody else as the verifier is that claim made on their behalf, which is the composition a
  // two-signatory release has to be impossible to build out of.
  it("refuses a release whose verifier is not the member recording it", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_notTheRecorder000",
        `'grant of probate', 'passport checked', '${WITNESS}', NULL`,
      ),
    ).toThrow(/cannot be named on their behalf/);
  });

  // A witness the firm does not employ is not a second person; it is a well-formed string. This is
  // the exact composition the gate existed to prevent and did not: one member typing any `user_…`
  // handle into the witness column and the ledger permanently asserting two signatures.
  it("refuses a witness who is not a member of this firm", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_strangerWitness00",
        `'grant of probate', 'passport checked', '${RECORDER}', '${STRANGER}'`,
      ),
    ).toThrow(/must be an active member of this firm/);
  });

  it("refuses a witness who has left the firm", () => {
    const { raw } = migratedDatabase();
    seedPacket(raw);
    expect(() =>
      insertRelease(
        raw,
        "custodyMovement_departedWitness00",
        `'grant of probate', 'passport checked', '${RECORDER}', '${DEPARTED}'`,
      ),
    ).toThrow(/must be an active member of this firm/);
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

// A stocktake sighting is a named person's assertion that they physically saw a specific original on
// a specific shelf on a specific day — the whole evidentiary value of a count. So it carries the
// movement ledger's append-only discipline, and like the ledger's it is asserted at the database with
// raw SQL: a service-level test would only prove that the service did not try.
describe("custody_stocktake_sighting is append-only at the database", () => {
  const SIGHTING_COLUMNS =
    "id, stocktake_id, kind, packet_id, item_id, location_id, expected_location_id, description, observed_at, recorded_at, observed_by_user_id, note";

  function seedSighting(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
    seedPacket(raw);
    raw.exec(`
      INSERT INTO custody_stocktake (id, name, status, opened_at, created_at, updated_at)
        VALUES ('custodyStocktake_seed00000000000', 'March count', 'open', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
      INSERT INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
        VALUES ('custodyStocktakeSighting_seed000', 'custodyStocktake_seed00000000000', 'sighted', 'custodyPacket_seed0000000000000000', NULL, 'custodyLocation_seed000000000000000', 'custodyLocation_seed000000000000000', NULL, '2026-08-05T09:00:00.000Z', '2026-08-05T09:00:00.000Z', NULL, NULL);
    `);
  }

  it("refuses an UPDATE", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    expect(() =>
      raw.exec(
        `UPDATE custody_stocktake_sighting SET kind = 'not_found' WHERE id = 'custodyStocktakeSighting_seed000'`,
      ),
    ).toThrow(/custody_stocktake_sighting is append-only/);
  });

  it("refuses a DELETE", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    expect(() =>
      raw.exec(
        `DELETE FROM custody_stocktake_sighting WHERE id = 'custodyStocktakeSighting_seed000'`,
      ),
    ).toThrow(/custody_stocktake_sighting is append-only/);
  });

  // REPLACE deletes-then-reinserts on a primary-key collision WITHOUT firing the delete or update
  // triggers, so without the BEFORE INSERT guard this would overwrite an evidentiary row in place.
  it("refuses an INSERT OR REPLACE onto an existing row", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    expect(() =>
      raw.exec(
        `INSERT OR REPLACE INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
           VALUES ('custodyStocktakeSighting_seed000', 'custodyStocktake_seed00000000000', 'sighted', 'custodyPacket_seed0000000000000000', NULL, 'custodyLocation_seed000000000000000', NULL, NULL, '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', NULL, NULL)`,
      ),
    ).toThrow(/custody_stocktake_sighting is append-only/);
  });

  it("still accepts a later, truer observation of the same packet", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    raw.exec(
      `INSERT INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
         VALUES ('custodyStocktakeSighting_later00', 'custodyStocktake_seed00000000000', 'not_found', 'custodyPacket_seed0000000000000000', NULL, 'custodyLocation_seed000000000000000', 'custodyLocation_seed000000000000000', NULL, '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z', NULL, NULL)`,
    );
    const rows = raw.prepare(`SELECT COUNT(*) AS total FROM custody_stocktake_sighting`).all() as {
      total: number;
    }[];
    // Both stay. A correction is the later observation, not an edit of the earlier one.
    expect(rows[0]?.total).toBe(2);
  });

  it("refuses an observation recorded against a count that has already closed", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    raw.exec(
      `UPDATE custody_stocktake SET status = 'closed', closed_at = '2026-08-05T12:00:00.000Z' WHERE id = 'custodyStocktake_seed00000000000'`,
    );
    expect(() =>
      raw.exec(
        `INSERT INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
           VALUES ('custodyStocktakeSighting_late000', 'custodyStocktake_seed00000000000', 'sighted', 'custodyPacket_seed0000000000000000', NULL, 'custodyLocation_seed000000000000000', NULL, NULL, '2026-08-05T13:00:00.000Z', '2026-08-05T13:00:00.000Z', NULL, NULL)`,
      ),
    ).toThrow(/only be recorded against an open stocktake/);
  });

  it("refuses an unregistered observation that describes nothing, and one that names a packet", () => {
    const { raw } = migratedDatabase();
    seedSighting(raw);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
           VALUES ('custodyStocktakeSighting_bare00', 'custodyStocktake_seed00000000000', 'unregistered', NULL, NULL, 'custodyLocation_seed000000000000000', NULL, NULL, '2026-08-05T13:00:00.000Z', '2026-08-05T13:00:00.000Z', NULL, NULL)`,
      ),
    ).toThrow(/custody_stocktake_sighting_shape_check/);
    expect(() =>
      raw.exec(
        `INSERT INTO custody_stocktake_sighting (${SIGHTING_COLUMNS})
           VALUES ('custodyStocktakeSighting_named0', 'custodyStocktake_seed00000000000', 'unregistered', 'custodyPacket_seed0000000000000000', NULL, 'custodyLocation_seed000000000000000', NULL, 'An envelope', '2026-08-05T13:00:00.000Z', '2026-08-05T13:00:00.000Z', NULL, NULL)`,
      ),
    ).toThrow(/custody_stocktake_sighting_shape_check/);
  });

  it("refuses a stocktake that claims to be open and closed at once", () => {
    const { raw } = migratedDatabase();
    expect(() =>
      raw.exec(
        `INSERT INTO custody_stocktake (id, name, status, opened_at, closed_at, created_at, updated_at)
           VALUES ('custodyStocktake_bothWays000000', 'March count', 'open', '2026-08-05T00:00:00.000Z', '2026-08-05T12:00:00.000Z', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ),
    ).toThrow(/custody_stocktake_closure_check/);
  });
});

// The sighting guards above all key off the PARENT row's `open` status. That made the parent the one
// piece of the design held up by nothing but the fact that one guarded UPDATE was the only UPDATE
// anybody had written — so a re-open, a second close, or a REPLACE would have quietly reactivated a
// count a firm had already reconciled and reported.
describe("a closed custody stocktake is frozen at the database", () => {
  function seedClosedStocktake(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
    raw.exec(`
      INSERT INTO custody_stocktake (id, name, status, opened_at, closed_at, matched_count, missing_count, created_at, updated_at)
        VALUES ('custodyStocktake_closed000000000', 'March count', 'closed', '2026-08-05T00:00:00.000Z', '2026-08-05T12:00:00.000Z', 41, 1, '2026-08-05T00:00:00.000Z', '2026-08-05T12:00:00.000Z');
    `);
  }

  it("refuses re-opening a closed count", () => {
    const { raw } = migratedDatabase();
    seedClosedStocktake(raw);
    expect(() =>
      raw.exec(
        `UPDATE custody_stocktake SET status = 'open', closed_at = NULL WHERE id = 'custodyStocktake_closed000000000'`,
      ),
    ).toThrow(/frozen/);
  });

  it("refuses rewriting a closed count's frozen findings", () => {
    const { raw } = migratedDatabase();
    seedClosedStocktake(raw);
    expect(() =>
      raw.exec(
        `UPDATE custody_stocktake SET missing_count = 0 WHERE id = 'custodyStocktake_closed000000000'`,
      ),
    ).toThrow(/frozen/);
  });

  it("refuses an INSERT OR REPLACE onto an existing count", () => {
    const { raw } = migratedDatabase();
    seedClosedStocktake(raw);
    expect(() =>
      raw.exec(
        `INSERT OR REPLACE INTO custody_stocktake (id, name, status, opened_at, created_at, updated_at)
           VALUES ('custodyStocktake_closed000000000', 'March count', 'open', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ),
    ).toThrow(/replaced by no write path/);
  });

  it("still accepts the ordinary close of an open count", () => {
    const { raw } = migratedDatabase();
    raw.exec(
      `INSERT INTO custody_stocktake (id, name, status, opened_at, created_at, updated_at)
         VALUES ('custodyStocktake_open00000000000', 'April count', 'open', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')`,
    );
    raw.exec(
      `UPDATE custody_stocktake SET status = 'closed', closed_at = '2026-08-06T12:00:00.000Z', matched_count = 3 WHERE id = 'custodyStocktake_open00000000000' AND status = 'open'`,
    );
    const rows = raw
      .prepare(
        `SELECT status, matched_count FROM custody_stocktake WHERE id = 'custodyStocktake_open00000000000'`,
      )
      .all() as { status: string; matched_count: number }[];
    expect(rows[0]).toEqual({ status: "closed", matched_count: 3 });
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
