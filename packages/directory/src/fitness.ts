import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// A reference that still points at a subordinate entity after a merge — the kind of dangling pointer
// a complete repoint must never leave behind. table/column name where the stale pointer lives, plus
// the offending row id, so a failure message is actionable.
export interface DanglingReference {
  readonly table: string;
  readonly column: string;
  readonly row: string;
}

// The thrown failure when the merge repoint is incomplete: at least one inbound reference still points
// at the subordinate. Carries the full list so a test or operator sees every stale pointer at once.
export class DanglingSubordinateReferenceError extends Error {
  readonly code = "dangling-subordinate-reference";
  readonly references: readonly DanglingReference[];
  constructor(subordinateId: string, references: readonly DanglingReference[]) {
    super(
      `directory: ${references.length} inbound reference(s) still point at the merged subordinate ${subordinateId}: ${references
        .map((r) => `${r.table}.${r.column}#${r.row}`)
        .join(", ")} (dangling-subordinate-reference)`,
    );
    this.name = "DanglingSubordinateReferenceError";
    this.references = references;
  }
}

// The reusable inbound-reference query: every real indexed column that a merge repoints from the
// subordinate to the master. Kept in one place so the merge's repoint set and this audit stay in
// lockstep — adding a new referencing column means adding it here too.
const INBOUND_REFERENCE_PROBES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "matter_party", column: "entity_id" },
  { table: "directory_edge", column: "from_entity_id" },
  { table: "directory_edge", column: "to_entity_id" },
  { table: "directory_entity_category", column: "entity_id" },
  { table: "custom_field_value", column: "value_reference_id" },
  { table: "custom_field_value", column: "target_row_id" },
  // The merge pointer itself is an inbound reference: a node whose merged_into_id names a subordinate is
  // a merge CHAIN, and resolution follows exactly one hop, so that node would resolve to an entity that
  // has itself been merged away. A merge flattens the chain by repointing these to the new master, which
  // is what these two probes prove.
  { table: "directory_person", column: "merged_into_id" },
  { table: "directory_organization", column: "merged_into_id" },
];

// findDanglingToSubordinate scans every inbound-reference column for rows that still point at the
// subordinate. Returns one DanglingReference per offending row across all probed tables. A complete,
// correct merge leaves this empty. Soft-deleted rows still count — a repoint must move them too, so a
// later undelete never resurrects a pointer to an archived subordinate.
export async function findDanglingToSubordinate(
  database: SqlDatabase,
  subordinateId: string,
): Promise<DanglingReference[]> {
  const found: DanglingReference[] = [];
  for (const probe of INBOUND_REFERENCE_PROBES) {
    // directory_entity_category has no own id column — its identity is the (entity_id, category_id)
    // composite, so report the category_id as the row discriminator. Every other probed table has id.
    const rowExpression = probe.table === "directory_entity_category" ? "category_id" : "id";
    const { results } = await database
      .prepare(`SELECT ${rowExpression} AS row FROM ${probe.table} WHERE ${probe.column} = ?1`)
      .bind(subordinateId)
      .all<{ row: string }>();
    for (const result of results) {
      found.push({ table: probe.table, column: probe.column, row: result.row });
    }
  }
  return found;
}

// assertNoDanglingToSubordinate is the fitness assertion: it throws DanglingSubordinateReferenceError
// if any inbound reference still points at the subordinate after a merge, and resolves silently when
// the repoint is complete. Wire it after a merge (or in a test) to prove the relink left nothing
// behind.
export async function assertNoDanglingToSubordinate(
  database: SqlDatabase,
  subordinateId: string,
): Promise<void> {
  const dangling = await findDanglingToSubordinate(database, subordinateId);
  if (dangling.length > 0) {
    throw new DanglingSubordinateReferenceError(subordinateId, dangling);
  }
}

// The two Double Metaphone scheme rows every indexed name must carry. Double Metaphone yields two codes
// per input (primary + secondary), stored one row per scheme so the blocking layer treats every scheme
// uniformly. A name missing either row is invisible to half the phonetic-blocking channel — exactly the
// silent corpus gap this fitness exists to catch.
const REQUIRED_PHONETIC_SCHEMES = [
  "double_metaphone_primary",
  "double_metaphone_secondary",
] as const;

// A live name row that is missing one or both of its Double Metaphone scheme codes. The id and the
// missing scheme list make the failure actionable — re-encoding that one name closes the gap.
export interface NameMissingPhonetics {
  readonly nameId: string;
  readonly missingSchemes: readonly string[];
}

// A live name row whose derived matching data is absent. `missing` names which derivation, so the
// failure says what to recompute rather than only that something is wrong.
//
// This probe reports TWO different situations and cannot tell them apart, which is deliberate: a row
// written before the derivation existed and not yet reached by the backfill sweep looks exactly like a
// row a write path forgot to derive. Both are the same fact for the conflicts corpus — that name is
// invisible to that blocking channel right now — and both are fixed by the same sweep. On a database
// the backfill has finished, any remaining row is a forgotten write path.
export interface NameMissingDerivation {
  readonly nameId: string;
  readonly missing: "match_keys";
}

// An edge endpoint that points at a soft-deleted entity. This system never hard-deletes; an edge whose
// source or target is archived is a dangling pointer the write path must never create.
export interface EdgeToDeletedEntity {
  readonly edgeId: string;
  readonly column: string;
  readonly entityId: string;
}

// The aggregate fitness failure: a table-wide audit found at least one broken invariant. Carries every
// offending row across every probe so one run surfaces the full corpus damage, not just the first hit.
export class DirectoryFitnessError extends Error {
  readonly code = "directory-fitness";
  readonly namesMissingPhonetics: readonly NameMissingPhonetics[];
  readonly namesMissingDerivedMatchingData: readonly NameMissingDerivation[];
  readonly edgesToDeletedEntities: readonly EdgeToDeletedEntity[];
  readonly danglingSubordinateReferences: readonly DanglingReference[];
  constructor(
    namesMissingPhonetics: readonly NameMissingPhonetics[],
    namesMissingDerivedMatchingData: readonly NameMissingDerivation[],
    edgesToDeletedEntities: readonly EdgeToDeletedEntity[],
    danglingSubordinateReferences: readonly DanglingReference[],
  ) {
    const parts: string[] = [];
    if (namesMissingPhonetics.length > 0) {
      parts.push(
        `${namesMissingPhonetics.length} name(s) missing a Double Metaphone code: ${namesMissingPhonetics
          .map((n) => `${n.nameId}[${n.missingSchemes.join("+")}]`)
          .join(", ")}`,
      );
    }
    if (namesMissingDerivedMatchingData.length > 0) {
      parts.push(
        `${namesMissingDerivedMatchingData.length} name(s) missing derived matching data: ${namesMissingDerivedMatchingData
          .map((n) => `${n.nameId}[${n.missing}]`)
          .join(", ")}`,
      );
    }
    if (edgesToDeletedEntities.length > 0) {
      parts.push(
        `${edgesToDeletedEntities.length} edge endpoint(s) point at a soft-deleted entity: ${edgesToDeletedEntities
          .map((e) => `${e.edgeId}.${e.column}#${e.entityId}`)
          .join(", ")}`,
      );
    }
    if (danglingSubordinateReferences.length > 0) {
      parts.push(
        `${danglingSubordinateReferences.length} inbound reference(s) still point at a merged subordinate: ${danglingSubordinateReferences
          .map((r) => `${r.table}.${r.column}#${r.row}`)
          .join(", ")}`,
      );
    }
    super(`directory: fitness violations — ${parts.join("; ")} (directory-fitness)`);
    this.name = "DirectoryFitnessError";
    this.namesMissingPhonetics = namesMissingPhonetics;
    this.namesMissingDerivedMatchingData = namesMissingDerivedMatchingData;
    this.edgesToDeletedEntities = edgesToDeletedEntities;
    this.danglingSubordinateReferences = danglingSubordinateReferences;
  }
}

// findNamesMissingPhonetics scans every live name row and reports any that lacks one or both Double
// Metaphone scheme codes. A LEFT JOIN per scheme would be one query, but a per-scheme NOT-EXISTS keeps
// the missing-scheme list precise per row. Soft-deleted names are excluded — an archived alias is out of
// the search/blocking corpus, so its codes no longer matter.
export async function findNamesMissingPhonetics(
  database: SqlDatabase,
): Promise<NameMissingPhonetics[]> {
  const { results } = await database
    .prepare(
      `SELECT n.id AS name_id, ` +
        REQUIRED_PHONETIC_SCHEMES.map(
          (_, index) =>
            `EXISTS (SELECT 1 FROM directory_name_phonetic_code pc WHERE pc.name_id = n.id AND pc.scheme = ?${index + 1}) AS scheme_${index}`,
        ).join(", ") +
        ` FROM directory_name n WHERE n.deleted_at IS NULL`,
    )
    .bind(...REQUIRED_PHONETIC_SCHEMES)
    .all<Record<string, string | number>>();

  const found: NameMissingPhonetics[] = [];
  for (const row of results) {
    const missingSchemes = REQUIRED_PHONETIC_SCHEMES.filter(
      (_, index) => Number(row[`scheme_${index}`]) === 0,
    );
    if (missingSchemes.length > 0) {
      found.push({ nameId: String(row["name_id"]), missingSchemes });
    }
  }
  return found;
}

// findNamesMissingDerivedMatchingData scans every live name row for the two match keys derived
// beside the phonetic codes.
//
// It reports TWO different situations and cannot tell them apart, which is deliberate: a row written
// before the columns existed and not yet reached by the backfill sweep looks exactly like a row a
// write path forgot to derive. Both are the same fact for the conflicts corpus — that name is
// invisible to the match-key channels right now — and both are fixed by the same sweep. On a database
// the backfill has finished, any remaining row is a forgotten write path.
export async function findNamesMissingDerivedMatchingData(
  database: SqlDatabase,
): Promise<NameMissingDerivation[]> {
  const { results } = await database
    .prepare(
      `SELECT id FROM directory_name
        WHERE deleted_at IS NULL
          AND (normalized_match_key IS NULL OR normalized_match_key_bare IS NULL)
        ORDER BY id ASC`,
    )
    .all<{ id: string }>();
  return results.map((row) => ({ nameId: row.id, missing: "match_keys" as const }));
}

// findEdgesToDeletedEntities scans both edge endpoints for a reference to a soft-deleted entity. An
// entity may be a person OR an organization, so each endpoint is probed against both node tables; an
// endpoint whose target row has deleted_at IS NOT NULL is a dangling reference. Edges of a soft-deleted
// entity must be soft-deleted with it — this catches a repoint/delete path that left one behind.
export async function findEdgesToDeletedEntities(
  database: SqlDatabase,
): Promise<EdgeToDeletedEntity[]> {
  const found: EdgeToDeletedEntity[] = [];
  for (const column of ["from_entity_id", "to_entity_id"]) {
    const { results } = await database
      .prepare(
        `SELECT e.id AS edge_id, e.${column} AS entity_id FROM directory_edge e
         WHERE e.deleted_at IS NULL
           AND (
             EXISTS (SELECT 1 FROM directory_person p WHERE p.id = e.${column} AND p.deleted_at IS NOT NULL)
             OR EXISTS (SELECT 1 FROM directory_organization o WHERE o.id = e.${column} AND o.deleted_at IS NOT NULL)
           )`,
      )
      .all<{ edge_id: string; entity_id: string }>();
    for (const row of results) {
      found.push({ edgeId: row.edge_id, column, entityId: row.entity_id });
    }
  }
  return found;
}

// findDanglingToAnySubordinate scans every merged-away entity (status='merged_into' in either node
// table) and collects every inbound reference still pointing at it. A complete merge leaves this empty
// across the whole corpus — the table-wide generalization of assertNoDanglingToSubordinate.
async function findDanglingToAnySubordinate(database: SqlDatabase): Promise<DanglingReference[]> {
  const found: DanglingReference[] = [];
  for (const table of ["directory_person", "directory_organization"]) {
    const { results } = await database
      .prepare(`SELECT id FROM ${table} WHERE status = 'merged_into'`)
      .all<{ id: string }>();
    for (const { id } of results) {
      found.push(...(await findDanglingToSubordinate(database, id)));
    }
  }
  return found;
}

// assertDirectoryFitness runs the table-wide directory invariant audit and throws DirectoryFitnessError
// if ANY invariant is broken, aggregating every offending row across all three probes:
//   1. Every live name carries BOTH Double Metaphone codes (primary + secondary) — no half-indexed name.
//   2. Every live name carries both match keys — a name missing them is invisible to a blocking
//      channel that the check will nonetheless report as having run.
//   3. No live edge endpoint points at a soft-deleted entity — this system soft-deletes only; an edge to
//      an archived entity is a dangling pointer.
//   4. No inbound reference (matter party, edge endpoint, category link, or another node's merge
//      pointer) still points at a merged-away subordinate — every merge repointed completely, and no
//      merge chain survives for a one-hop resolution to fall off.
// Resolves silently when the directory is sound. Wire it as a fitness function (a test, or a periodic
// integrity sweep) to prove the corpus invariants hold.
export async function assertDirectoryFitness(database: SqlDatabase): Promise<void> {
  const [
    namesMissingPhonetics,
    namesMissingDerivedMatchingData,
    edgesToDeletedEntities,
    danglingSubordinateReferences,
  ] = await Promise.all([
    findNamesMissingPhonetics(database),
    findNamesMissingDerivedMatchingData(database),
    findEdgesToDeletedEntities(database),
    findDanglingToAnySubordinate(database),
  ]);

  if (
    namesMissingPhonetics.length > 0 ||
    namesMissingDerivedMatchingData.length > 0 ||
    edgesToDeletedEntities.length > 0 ||
    danglingSubordinateReferences.length > 0
  ) {
    throw new DirectoryFitnessError(
      namesMissingPhonetics,
      namesMissingDerivedMatchingData,
      edgesToDeletedEntities,
      danglingSubordinateReferences,
    );
  }
}
