import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterEstateId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { matterAuditStatement } from "./audit.ts";
import { MatterValidationError } from "./validation.ts";

// The estate a probate matter administers — the matter's own identity record for the decedent, the
// date of death, and the styles a court has fixed. THE STYLES ARE STORED, NEVER COMPOSED: "the
// Estate of Rowan Ashcroft, Deceased" is a legal designation a firm may need to state exactly as
// the court has it, and a composed string would be right most of the time, which is the worst
// frequency. The decedent is a Directory person (so every name rendering applies to them) and the
// estate's own Directory organisation, where the firm keeps one, is where the estate's tax
// identifier lives through the ordinary encrypted-identifier machinery. One live record per matter,
// upserted as its facts accrete — a date of death at opening, letters when the court issues them.

export const ESTATE_PROCEEDING_TYPES = [
  "testate",
  "intestate",
  "small_estate",
  "ancillary",
] as const;
export type EstateProceedingType = (typeof ESTATE_PROCEEDING_TYPES)[number];

export interface MatterEstateFields {
  readonly decedentEntityId: string | null;
  readonly estateEntityId: string | null;
  readonly dateOfDeath: string | null;
  readonly estateStyle: string | null;
  readonly shortStyle: string | null;
  readonly proceedingType: EstateProceedingType | null;
  readonly lettersIssuedOn: string | null;
}

export interface MatterEstateRecord extends MatterEstateFields {
  readonly id: MatterEstateId;
  readonly matterId: MatterId;
}

interface EstateColumns {
  id: string;
  matter_id: string;
  decedent_entity_id: string | null;
  estate_entity_id: string | null;
  date_of_death: string | null;
  estate_style: string | null;
  short_style: string | null;
  proceeding_type: string | null;
  letters_issued_on: string | null;
}

function toRecord(columns: EstateColumns): MatterEstateRecord {
  return {
    id: columns.id as MatterEstateId,
    matterId: columns.matter_id as MatterId,
    decedentEntityId: columns.decedent_entity_id,
    estateEntityId: columns.estate_entity_id,
    dateOfDeath: columns.date_of_death,
    estateStyle: columns.estate_style,
    shortStyle: columns.short_style,
    proceedingType: (columns.proceeding_type as EstateProceedingType | null) ?? null,
    lettersIssuedOn: columns.letters_issued_on,
  };
}

export async function readMatterEstate(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<MatterEstateRecord | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, decedent_entity_id, estate_entity_id, date_of_death, estate_style, short_style, proceeding_type, letters_issued_on
         FROM matter_estate WHERE matter_id = ?1 AND deleted_at IS NULL`,
    )
    .bind(matterId)
    .all<EstateColumns>();
  const row = results[0];
  return row === undefined ? undefined : toRecord(row);
}

async function assertLiveEntity(
  database: SqlDatabase,
  table: "directory_person" | "directory_organization",
  entityId: string,
  what: string,
): Promise<void> {
  const { results } = await database
    .prepare(`SELECT 1 AS one FROM ${table} WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(entityId)
    .all<{ one: number }>();
  if (results.length === 0) {
    throw new MatterValidationError("unknown-entity", `${what} names no live Directory record`);
  }
}

export async function composeSetMatterEstate(
  database: BatchDatabase,
  matterId: MatterId,
  fields: MatterEstateFields,
  context: {
    clock: { now(): string };
    actorUserId: UserId | null;
    randomSource?: RandomSource;
  },
): Promise<{ statements: SqlStatement[]; estateId: MatterEstateId }> {
  const { results: matterRows } = await database
    .prepare("SELECT 1 AS one FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<{ one: number }>();
  if (matterRows.length === 0) {
    throw new MatterValidationError("matter-not-found", `no such matter: ${matterId}`);
  }
  if (fields.decedentEntityId !== null) {
    await assertLiveEntity(database, "directory_person", fields.decedentEntityId, "the decedent");
  }
  if (fields.estateEntityId !== null) {
    await assertLiveEntity(
      database,
      "directory_organization",
      fields.estateEntityId,
      "the estate's own record",
    );
  }

  const existing = await readMatterEstate(database, matterId);
  const now = context.clock.now();
  if (existing !== undefined) {
    return {
      estateId: existing.id,
      statements: [
        database
          .prepare(
            `UPDATE matter_estate
                SET decedent_entity_id = ?2, estate_entity_id = ?3, date_of_death = ?4,
                    estate_style = ?5, short_style = ?6, proceeding_type = ?7,
                    letters_issued_on = ?8, updated_at = ?9
              WHERE id = ?1`,
          )
          .bind(
            existing.id,
            fields.decedentEntityId,
            fields.estateEntityId,
            fields.dateOfDeath,
            fields.estateStyle,
            fields.shortStyle,
            fields.proceedingType,
            fields.lettersIssuedOn,
            now,
          ),
        matterAuditStatement(database, context, "matter.estate.updated", existing.id, { matterId }),
      ],
    };
  }
  const estateId = newIdentifier("matterEstate", context.randomSource);
  return {
    estateId,
    statements: [
      database
        .prepare(
          `INSERT INTO matter_estate (id, matter_id, decedent_entity_id, estate_entity_id, date_of_death, estate_style, short_style, proceeding_type, letters_issued_on, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
        )
        .bind(
          estateId,
          matterId,
          fields.decedentEntityId,
          fields.estateEntityId,
          fields.dateOfDeath,
          fields.estateStyle,
          fields.shortStyle,
          fields.proceedingType,
          fields.lettersIssuedOn,
          now,
        ),
      matterAuditStatement(database, context, "matter.estate.created", estateId, { matterId }),
    ],
  };
}
