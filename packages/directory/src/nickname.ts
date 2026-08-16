import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { NICKNAME_EQUIVALENCE_TABLE } from "./statements.ts";

// The nickname equivalence catalogue — REGISTERED, AND SHIPPED EMPTY.
//
// `Bob`/`Robert`, `Bill`/`William`, `Peggy`/`Margaret` are not phonetic relationships. No encoder
// derives them, because there is nothing in the sound of one that produces the other; they are a
// curated list, and curating one carries a licensing question this platform has not answered.
//
// Shipping the empty table rather than nothing at all is the whole point, and it is the same posture
// prior-firm history already holds. A conflicts check that simply omitted nicknames would leave a
// reader of its log unable to tell "we searched nickname equivalents and none matched" from "nobody
// ever built that". Recording the source as one the check could not search states the gap plainly,
// which is the only honest thing to say about a dimension nothing has been curated for.
//
// The read exists so the day the catalogue is populated is a data change rather than a code change.

export interface NicknameEquivalence {
  readonly nameForm: string;
  readonly equivalentForm: string;
  readonly source: string;
}

// Every recorded equivalent of one name form, in BOTH directions: a curator records `bob` implies
// `robert` as one directed row, and a search for either has to reach the other. Returns an empty list
// on the shipped corpus, which is the state `nicknameCatalogueIsPopulated` reports on.
export async function readNicknameEquivalences(
  database: SqlDatabase,
  nameForm: string,
): Promise<NicknameEquivalence[]> {
  const form = nameForm.trim().toLowerCase();
  if (form.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT name_form, equivalent_form, source FROM ${NICKNAME_EQUIVALENCE_TABLE}
        WHERE name_form = ?1 OR equivalent_form = ?1
        ORDER BY name_form ASC, equivalent_form ASC`,
    )
    .bind(form)
    .all<{ name_form: string; equivalent_form: string; source: string }>();
  return results.map((row) => ({
    nameForm: row.name_form,
    equivalentForm: row.equivalent_form,
    source: row.source,
  }));
}

// Whether the catalogue holds anything at all. A conflicts check asks this once so its log can say
// what it says for a reason it read rather than a constant somebody wrote — the day a firm curates a
// catalogue, the log stops claiming the dimension was unsearchable without anybody editing this file.
export async function nicknameCatalogueIsPopulated(database: SqlDatabase): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT 1 AS present FROM ${NICKNAME_EQUIVALENCE_TABLE} LIMIT 1`)
    .all<{ present: number }>();
  return results.length > 0;
}
