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

/**
 * One row of the index: who the record is, and the few facts a reader sorts and narrows a book of
 * names by.
 *
 * WHAT A ROW CARRIES IS DECIDED BY WHAT A COLUMN CAN BE. A listing row used to carry the name, the
 * kind and the date, because those were the three columns; a reader who wanted to find everyone in
 * one city, or to sort by family name, or to see whether the firm holds an address for somebody,
 * had to open records one at a time. So the row carries the parts of the name it was assembled
 * from, and the record's DEFAULT way to reach them — the primary email, the primary number, and the
 * locality of the primary address. None of it is a contact register: it is one value per channel,
 * the one a message goes to when nobody named an address, and the record's own Contact section is
 * still where the rest lives.
 *
 * A sealed identifier is deliberately not here and never will be: reading one is a decrypt, it is
 * permission-gated, and it writes an audit row before any plaintext exists. A column cannot ask
 * that of a page of fifty records.
 */
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
  /** A person's first name, as the record holds it. Null for an organization. */
  readonly givenName: string | null;
  /** A person's middle name. Null for an organization, and null where none was recorded. */
  readonly middleName: string | null;
  /**
   * A person's last name. Null for an organization, and null for a person who has one name — a
   * record with no family name is a record the firm keeps, not one it refuses.
   */
  readonly familyName: string | null;
  /** The default email address for the record, or null where the firm holds none. */
  readonly emailAddress: string | null;
  /** The default number for the record, as it was entered, or null where the firm holds none. */
  readonly phoneNumber: string | null;
  /** The locality of the default address — the city, town or village. */
  readonly city: string | null;
  /** The administrative area of the default address, where the country has one. */
  readonly region: string | null;
  /** The default address's country, ISO 3166-1 alpha-2. */
  readonly country: string | null;
  /** When the firm wrote the record down. */
  readonly recordedAt: string;
  /** When the record itself last changed. Not a change to anything hanging off it. */
  readonly changedAt: string;
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
  "name_suffix, created_at, updated_at " +
  `FROM directory_person WHERE ${LIVE_RECORD}`;

const ORGANIZATION_BRANCH =
  `SELECT id, 'organization' AS entity_kind, ${ORGANIZATION_SORT_NAME} AS sort_name, ` +
  "display_name, legal_name, NULL AS name_prefix, NULL AS name_given, NULL AS name_middle, " +
  "NULL AS name_family, NULL AS name_suffix, created_at, updated_at " +
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
  updated_at: string;
}

/**
 * The default way to reach one record — one value per channel, and nothing about the rest.
 *
 * Read for the PAGE rather than joined into the listing query, and that is the shape to keep. The
 * listing is a union of two node tables with a computed sort key over it, and hanging three
 * correlated subqueries off that union makes the count query and the walk pay for contact rows on
 * every record the firm holds, not on the fifty being shown. One extra round trip bounded by the
 * page size is the cheaper half of that trade, and it stays cheap as the directory grows.
 */
interface ContactSummary {
  readonly emailAddress: string | null;
  readonly phoneNumber: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
}

const NO_CONTACT: ContactSummary = {
  emailAddress: null,
  phoneNumber: null,
  city: null,
  region: null,
  country: null,
};

// Which row of a channel is the record's default. `is_primary` names it outright; where nothing was
// marked, the oldest row stands in, because the first one recorded is the one the firm has been
// using. Ordering by id after created_at makes the choice deterministic where two landed together.
const DEFAULT_ROW_ORDER = "ORDER BY is_primary DESC, created_at ASC, id ASC";

interface ContactSummaryRow {
  entity_id: string;
  email_address: string | null;
  phone_number: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** The default email, number and address locality for each record on the page, in one query. */
async function readContactSummaries(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<ReadonlyMap<string, ContactSummary>> {
  const summaries = new Map<string, ContactSummary>();
  if (entityIds.length === 0) return summaries;
  const placeholders = entityIds.map(() => "?").join(", ");
  // One statement per channel would be three round trips for one strip of columns. The channels
  // are unioned into one shape instead, each contributing only its own columns, and folded together
  // here — every row carries an entity and exactly one channel's worth of values.
  const channel = (table: string, columns: string) =>
    `SELECT entity_id, ${columns} FROM ${table} ` +
    `WHERE entity_id IN (${placeholders}) AND deleted_at IS NULL ${DEFAULT_ROW_ORDER}`;
  const [emails, phones, addresses] = await Promise.all([
    database
      .prepare(
        channel(
          "directory_email",
          "address AS email_address, NULL AS phone_number, NULL AS city, NULL AS region, " +
            "NULL AS country",
        ),
      )
      .bind(...entityIds)
      .all<ContactSummaryRow>(),
    database
      .prepare(
        channel(
          "directory_phone",
          "NULL AS email_address, number AS phone_number, NULL AS city, NULL AS region, " +
            "NULL AS country",
        ),
      )
      .bind(...entityIds)
      .all<ContactSummaryRow>(),
    database
      .prepare(
        channel(
          "directory_address",
          "NULL AS email_address, NULL AS phone_number, city, region, country",
        ),
      )
      .bind(...entityIds)
      .all<ContactSummaryRow>(),
  ]);

  // First row per entity wins, which is the default row: the ordering above already put it first.
  const fold = (
    rows: readonly ContactSummaryRow[],
    take: (row: ContactSummaryRow) => Partial<ContactSummary>,
  ) => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.entity_id)) continue;
      seen.add(row.entity_id);
      summaries.set(row.entity_id, {
        ...(summaries.get(row.entity_id) ?? NO_CONTACT),
        ...take(row),
      });
    }
  };
  fold(emails.results, (row) => ({ emailAddress: row.email_address }));
  fold(phones.results, (row) => ({ phoneNumber: row.phone_number }));
  fold(addresses.results, (row) => ({ city: row.city, region: row.region, country: row.country }));
  return summaries;
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
                name_middle, name_family, name_suffix, created_at, updated_at
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
  const contact = await readContactSummaries(
    database,
    rows.map((row) => row.id),
  );

  return {
    data: rows.map((row) => {
      const displayName = displayNameFromRow(row);
      const reach = contact.get(row.id) ?? NO_CONTACT;
      return {
        entityId: row.id,
        // The literal each branch selects, narrowed back to the domain type it came from.
        entityKind: row.entity_kind === "organization" ? "organization" : "person",
        displayName,
        legalName: distinctLegalName(row, displayName),
        givenName: row.name_given,
        middleName: row.name_middle,
        familyName: row.name_family,
        emailAddress: reach.emailAddress,
        phoneNumber: reach.phoneNumber,
        city: reach.city,
        region: reach.region,
        country: reach.country,
        recordedAt: row.created_at,
        changedAt: row.updated_at,
      };
    }),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.sort_name, last.id) : null,
    total: count.results[0]?.total ?? 0,
  };
}
