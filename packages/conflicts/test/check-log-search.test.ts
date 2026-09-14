import { beforeAll, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  selectConflictsChecksStatement,
  type ConflictsCheckSummaryRow,
} from "../src/statements.ts";

/*
 * SEARCHING THE FIRM'S CONFLICTS LOG.
 *
 * The check row holds almost no text a person types. `trigger`, `strictness` and `trigger_source`
 * are closed labels the register narrows by from its own column filters, and `inputs_json` records
 * identifiers BY REFERENCE rather than plaintext names — deliberately. So the search answers the
 * two questions those filters cannot: which MATTER a run was made against, and whose NAME it
 * surfaced.
 *
 * The second is the one with professional-responsibility weight. "Has this firm ever checked this
 * person" is a question a firm may have to answer months later, and before this it could only be
 * answered by opening every check in the log.
 */

const AT = "2026-01-01T00:00:00.000Z";
const MEMBER = "user_logsearchreader0";
const MATTER_A = "matter_logsearch0001";
const MATTER_B = "matter_logsearch0002";
const CHECK_A = "conflictsCheck_00000000000001";
const CHECK_B = "conflictsCheck_00000000000002";
const CHECK_C = "conflictsCheck_00000000000003";
const PERSON = "directoryPerson_000000000001";

let handle: ReturnType<typeof createMigratedNodeDatabase>;

beforeAll(async () => {
  handle = createMigratedNodeDatabase("per-firm");
  const database = handle.database;

  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Reader', 'active', 0, ?2)",
    )
    .bind(MEMBER, AT)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, matter_number, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Vance Estate', 'open', '2026-0042', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER_A, MEMBER, AT)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, matter_number, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, 'Ashford Trust', 'open', '2026-0099', ?2, 0, ?3, ?3)",
    )
    .bind(MATTER_B, MEMBER, AT)
    .run();

  const check = (id: string, matterId: string | null, at: string) =>
    database
      .prepare(
        "INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES (?1, 'new_matter', ?2, '[]', '{}', 'balanced', 2, '{}', 0, ?3, ?4)",
      )
      .bind(id, matterId, MEMBER, at)
      .run();
  await check(CHECK_A, MATTER_A, "2026-01-01T01:00:00.000Z");
  await check(CHECK_B, MATTER_B, "2026-01-01T02:00:00.000Z");
  // A pre-consult check against a party set with no matter yet — the null-matter arm.
  await check(CHECK_C, null, "2026-01-01T03:00:00.000Z");

  // A candidate the third check surfaced, and the directory name it resolves to. The name is stored
  // normalized, which is why the search normalizes the term the same way.
  await database
    .prepare(
      "INSERT INTO directory_name (id, entity_id, entity_kind, name_role, name_given, name_family, normalized_display, created_at, updated_at) VALUES (?1, ?2, 'person', 'legal', 'Marguerite', ?3, ?4, ?5, ?5)",
    )
    .bind("directoryName_0000000000001", PERSON, "O'Brien", "marguerite obrien", AT)
    .run();
  await database
    .prepare(
      "INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at) VALUES (?1, ?2, ?3, 'party', 1, '[]', '[]', 0, ?4)",
    )
    .bind("conflictsHit_00000000000001", CHECK_C, PERSON, AT)
    .run();
});

function search(term?: string) {
  return selectConflictsChecksStatement(handle.database, {
    ...(term === undefined ? {} : { search: term }),
    limit: 50,
  }).all<ConflictsCheckSummaryRow>();
}

describe("the conflicts log's search", () => {
  it("finds a run by the number of the matter it was made against", async () => {
    const { results } = await search("2026-0099");
    expect(results.map((row) => row.id)).toEqual([CHECK_B]);
  });

  it("finds a run by the title of the matter it was made against", async () => {
    const { results } = await search("Vance");
    expect(results.map((row) => row.id)).toEqual([CHECK_A]);
  });

  it("finds a run by a name it surfaced — the question the log exists to answer", async () => {
    const { results } = await search("Marguerite");
    expect(results.map((row) => row.id)).toEqual([CHECK_C]);
  });

  it("normalizes the term the way the corpus was normalized", async () => {
    // The directory stores `marguerite obrien`; a person types the apostrophe. Both reach the row.
    const { results } = await search("O'Brien");
    expect(results.map((row) => row.id)).toEqual([CHECK_C]);
  });

  it("returns the whole log when nothing is asked", async () => {
    const { results } = await search();
    expect(results).toHaveLength(3);
  });

  it("treats a blank term as no search at all", async () => {
    const { results } = await search("   ");
    expect(results).toHaveLength(3);
  });

  it("escapes a reader's wildcards rather than obeying them", async () => {
    const { results } = await search("%");
    expect(results).toHaveLength(0);
  });

  it("drops the name arm for a term that normalizes away, rather than matching every name", async () => {
    // The bug this pins: `normalizeName` strips punctuation, so these terms normalize to the empty
    // string — and a contains-pattern built from an empty term is `%%`, which every stored name
    // matches. A reader typing one stray character would have been handed the whole log as though
    // every check had surfaced their query.
    for (const term of ["%", "&", "...", "!!"]) {
      const { results } = await search(term);
      expect(results, `"${term}" must not match every name`).toHaveLength(0);
    }
  });

  it("keeps the newest-first order a search narrows", async () => {
    // Ordering is the log's own contract and a narrowing must not quietly change it.
    const { results } = await search("2026-00");
    expect(results.map((row) => row.id)).toEqual([CHECK_B, CHECK_A]);
  });

  it("composes with the matter filter rather than replacing it", async () => {
    const { results } = await selectConflictsChecksStatement(handle.database, {
      matterId: MATTER_A,
      search: "Vance",
      limit: 50,
    }).all<ConflictsCheckSummaryRow>();
    expect(results.map((row) => row.id)).toEqual([CHECK_A]);

    // The same term against a different matter narrows to nothing rather than ignoring one half.
    const other = await selectConflictsChecksStatement(handle.database, {
      matterId: MATTER_B,
      search: "Vance",
      limit: 50,
    }).all<ConflictsCheckSummaryRow>();
    expect(other.results).toHaveLength(0);
  });
});
