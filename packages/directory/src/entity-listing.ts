/*
 * The firm's directory as an INDEX — every person and organization it holds, in name order.
 *
 * This is the read that answers "show me everyone", and it is a different question from the one
 * `search.ts` answers. A ranked search returns its best matches in relevance order and stops; it
 * cannot be walked and it cannot be counted, so it can never stand in for an index. This read is
 * the opposite shape on purpose: one deterministic order, walkable to the end by cursor, and a
 * count of the whole record beside the page. A firm that has entered twenty clients can see that it
 * holds twenty.
 *
 * ONE BOOK, BOTH KINDS. People and organizations are unioned into a single ordered sequence rather
 * than listed as two registers, because the directory is one book of everyone the firm deals with
 * and a reader looking for "Pemberton" does not know in advance whether the firm filed a person or
 * a company. Kind narrows the same sequence; it never splits it.
 *
 * WHAT IS LEFT OUT, and why each is not an omission:
 *
 *   - A deleted record. `deleted_at` is the firm's own removal.
 *   - A record folded into another by a merge. Its names still answer a search and still resolve to
 *     the survivor, which is what the merge is for, but listing it beside its survivor would show
 *     one client as two — the exact thing the merge was performed to stop.
 *
 * THE ORDERING KEY IS COMPUTED, not stored, so this read scans the two node tables rather than
 * seeking an index. That is honest at a firm's directory size and it is the thing to change first
 * if it ever stops being: the fix is a stored, normalized sort column on each node table, written
 * on the same statements that write the name, and an index over it.
 */
import {
  DEFAULT_PAGE_SIZE,
  appendCursorPredicateOnColumn,
  decodeCursor,
  encodeCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { displayNameFromRow } from "./entity-display.ts";
import type { EntityKind } from "./types.ts";

/** One row of the index: who the record is, and nothing about what it holds. */
export interface DirectoryEntityListingRow {
  readonly entityId: string;
  readonly entityKind: EntityKind;
  /**
   * What to call the record, or null where the directory holds no name for it at all. A caller
   * shows the gap rather than inventing a placeholder, and never falls back to printing the handle.
   */
  readonly displayName: string | null;
  /**
   * An organization's legal name, where the firm recorded one that is not what it calls the
   * organization. Null for a person, and null where the two are the same.
   */
  readonly legalName: string | null;
  /** When the firm wrote the record down. */
  readonly recordedAt: string;
}

/**
 * A page of the index, with the size of the WHOLE record beside it.
 *
 * `total` counts every record the same filters admit, not the rows on this page, and that is the
 * fact a listing has to carry: a page of fifty out of two thousand and a page of fifty that is the
 * entire directory look identical without it.
 */
export interface DirectoryEntityListingPage {
  readonly data: readonly DirectoryEntityListingRow[];
  readonly nextCursor: string | null;
  readonly total: number;
}

/** Which side of the directory to list, or both. */
export type DirectoryEntityListingKind = EntityKind | "all";

// The order key, spelled out per node table so the two branches of the union sort against the same
// idea of a name: what the firm calls the record, and failing that the parts it holds. It mirrors
// the projection in entity-display.ts, so a row never sorts under one name and prints another.
//
// LOWER is SQLite's ASCII-only fold, so a name outside ASCII sorts by its code points rather than
// by a locale's collation. That is a stable, explainable order rather than a correct-by-locale one,
// and moving to a correct one means storing the normalized key rather than computing it here.
const PERSON_SORT_NAME =
  "LOWER(COALESCE(NULLIF(TRIM(display_name), ''), TRIM(" +
  "COALESCE(name_prefix || ' ', '') || COALESCE(name_given || ' ', '') || " +
  "COALESCE(name_middle || ' ', '') || COALESCE(name_family || ' ', '') || " +
  "COALESCE(name_suffix, '')), ''))";

const ORGANIZATION_SORT_NAME =
  "LOWER(COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(legal_name), ''), ''))";

// A record the firm still holds under its own identity: not removed, and not folded into another.
const LIVE_RECORD = "deleted_at IS NULL AND merged_into_id IS NULL";

const PERSON_BRANCH =
  `SELECT id, 'person' AS entity_kind, ${PERSON_SORT_NAME} AS sort_name, ` +
  "display_name, NULL AS legal_name, name_prefix, name_given, name_middle, name_family, " +
  "name_suffix, created_at " +
  `FROM directory_person WHERE ${LIVE_RECORD}`;

const ORGANIZATION_BRANCH =
  `SELECT id, 'organization' AS entity_kind, ${ORGANIZATION_SORT_NAME} AS sort_name, ` +
  "display_name, legal_name, NULL AS name_prefix, NULL AS name_given, NULL AS name_middle, " +
  "NULL AS name_family, NULL AS name_suffix, created_at " +
  `FROM directory_organization WHERE ${LIVE_RECORD}`;

/** The union the page and the count both read, narrowed to one side of the directory or neither. */
function unionedRecords(kind: DirectoryEntityListingKind): string {
  if (kind === "person") return PERSON_BRANCH;
  if (kind === "organization") return ORGANIZATION_BRANCH;
  return `${PERSON_BRANCH} UNION ALL ${ORGANIZATION_BRANCH}`;
}

interface ListingRow {
  id: string;
  entity_kind: string;
  sort_name: string;
  display_name: string | null;
  legal_name: string | null;
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
  created_at: string;
}

/**
 * An organization's legal name only where it says something the display name does not.
 *
 * Printing both when they are the same word twice is noise; printing the legal name when it differs
 * is what lets a reader tell "Pemberton Holdings" from the entity a pleading has to name.
 */
function distinctLegalName(row: ListingRow, displayName: string | null): string | null {
  const legal = row.legal_name?.trim() ?? "";
  if (legal === "") return null;
  return legal === displayName ? null : legal;
}

/**
 * The directory, in name order and cursor-paged, with the size of the whole record.
 *
 * The cursor is the platform's opaque (sort key, id) token, minted over the computed name rather
 * than over a timestamp — the same encoding every other list uses, so nothing about the wire
 * contract forks for this read.
 */
export async function readEntityListing(
  database: SqlDatabase,
  options: {
    readonly kind?: DirectoryEntityListingKind;
    readonly cursor?: string;
    readonly pageSize?: number;
  } = {},
): Promise<DirectoryEntityListingPage> {
  const kind = options.kind ?? "all";
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const records = unionedRecords(kind);

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  appendCursorPredicateOnColumn(conditions, bindings, decodeCursor(options.cursor), {
    sortColumn: "sort_name",
    idColumn: "id",
    ascending: true,
  });
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")} `;
  // One extra row is the has-more probe; it is trimmed off before the page is returned.
  bindings.push(pageSize + 1);

  const [page, count] = await Promise.all([
    database
      .prepare(
        `SELECT id, entity_kind, sort_name, display_name, legal_name, name_prefix, name_given,
                name_middle, name_family, name_suffix, created_at
           FROM (${records})
          ${where}ORDER BY sort_name ASC, id ASC
          LIMIT ?`,
      )
      .bind(...bindings)
      .all<ListingRow>(),
    // The count answers the same question the page does, under the same filters and without the
    // cursor: walking to page three does not make the firm's directory smaller.
    database.prepare(`SELECT COUNT(*) AS total FROM (${records})`).all<{ total: number }>(),
  ]);

  const hasMore = page.results.length > pageSize;
  const rows = hasMore ? page.results.slice(0, pageSize) : page.results;
  const last = rows.at(-1);

  return {
    data: rows.map((row) => {
      const displayName = displayNameFromRow(row);
      return {
        entityId: row.id,
        // The literal each branch selects, narrowed back to the domain type it came from.
        entityKind: row.entity_kind === "organization" ? "organization" : "person",
        displayName,
        legalName: distinctLegalName(row, displayName),
        recordedAt: row.created_at,
      };
    }),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.sort_name, last.id) : null,
    total: count.results[0]?.total ?? 0,
  };
}
