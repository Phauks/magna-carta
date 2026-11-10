import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { readEntityDisplayNames, type EntityDisplayName } from "./entity-display.ts";

// Who in the Directory answers on a number — the free, first half of "who is calling".
//
// A receptionist types the digits off a caller ID; the Directory already holds every number the firm
// has recorded for its contacts, split into the two parts directory_phone indexes. Matching on those
// parts rather than on the text as entered is what makes "(702) 555-0142" and "+1 702 555 0142" the
// same number.
//
// A NUMBER RECORDED WITHOUT ITS COUNTRY STILL MATCHES. A number typed into a contact as
// "702-555-0142" carries no country calling code, so its row has a null code and the national digits;
// the same number typed with a leading 1 but no plus keeps the 1 inside the national digits. Both are
// how people actually write a domestic number, and a lookup that missed them would say "nobody" about
// a client the firm has on file.
//
// THIN ON PURPOSE, on the readEntityDisplayNames line: it answers which records and what to call them,
// never their other contact points, so it is safe behind any authenticated session that may already
// search the Directory by name.

/** How many records one number may name. More than this is a shared switchboard, not a caller. */
export const MAX_PHONE_MATCHES = 5;

export interface PhoneMatchNumber {
  /** Digits only, no plus. */
  readonly countryCallingCode: string;
  /** Digits only. */
  readonly nationalNumber: string;
}

/**
 * The live Directory records that list this number, named. A record folded into another by a merge is
 * left out — the surviving record carries the number now — and so is a deleted number or record.
 */
export async function findEntitiesByPhoneNumber(
  database: SqlDatabase,
  number: PhoneMatchNumber,
): Promise<EntityDisplayName[]> {
  const { results } = await database
    .prepare(
      `SELECT DISTINCT entity_id
         FROM directory_phone
        WHERE deleted_at IS NULL
          AND (
                (country_calling_code = ?1 AND national_number = ?2)
             OR (country_calling_code IS NULL AND (national_number = ?2 OR national_number = ?1 || ?2))
          )
        ORDER BY entity_id
        LIMIT ?3`,
    )
    .bind(number.countryCallingCode, number.nationalNumber, MAX_PHONE_MATCHES * 2)
    .all<{ entity_id: string }>();
  const named = await readEntityDisplayNames(
    database,
    results.map((row) => row.entity_id),
  );
  return named.filter((entity) => entity.mergedIntoId === null).slice(0, MAX_PHONE_MATCHES);
}
