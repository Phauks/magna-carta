import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { EntityKind } from "./types.ts";

// Naming a page of entities, in one read.
//
// Everything else in this package answers about ONE entity, and that is right for a record somebody
// opened. It is wrong for a list: the custody register holds property for owners it can only name by
// handle, a conflicts hit names the party it matched by handle, and a duplicate-candidate answer is a
// column of handles. Each of those is a page of rows, so resolving them one entity per request is the
// N+1 every listing in this product is written to avoid.
//
// SO THIS READ IS DELIBERATELY THIN, and the thinness is the safety argument rather than a
// performance one. It answers display identity and nothing else — the id, which side of the directory
// it is, what to call it, and whether the record has been folded into another. No identifier is
// touched, so nothing here can decrypt; no contact row is joined, so a caller cannot turn a list of
// names into a mailing list. That is what makes it cheap enough to call for every row on screen and
// safe enough to leave behind an authenticated session with no further capability.

/**
 * How many entities one call may name.
 *
 * The bound is D1's cap on bound parameters, which is what the read chunks against anyway, and it
 * keeps the request line well inside every proxy's URL limit (a person handle is 37 characters, an
 * organization handle 43). A caller with more than this has a page larger than a page.
 */
export const MAX_ENTITY_DISPLAY_NAME_LOOKUP = 100;

/** One entity's display identity — who it is on a row, and nothing about what it holds. */
export interface EntityDisplayName {
  readonly entityId: string;
  readonly entityKind: EntityKind;
  /**
   * What to call it, or null when the directory holds no name at all for the record. A caller shows
   * the gap rather than inventing a placeholder, and never falls back to printing the handle.
   */
  readonly displayName: string | null;
  /** The surviving record this one was folded into, or null while it stands on its own. */
  readonly mergedIntoId: string | null;
}

// The stored display name wins where the firm set one; otherwise a person is assembled from the
// parts the record holds, because a person created through the API always has parts and may never
// get a display_name written. Mirrors partyDisplayName in party.ts — same rule, same order.
function displayNameFromRow(row: {
  display_name: string | null;
  legal_name?: string | null;
  name_prefix?: string | null;
  name_given?: string | null;
  name_middle?: string | null;
  name_family?: string | null;
  name_suffix?: string | null;
}): string | null {
  const display = row.display_name?.trim() ?? "";
  if (display !== "") return display;
  const legal = row.legal_name?.trim() ?? "";
  if (legal !== "") return legal;
  const assembled = [
    row.name_prefix,
    row.name_given,
    row.name_middle,
    row.name_family,
    row.name_suffix,
  ]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return assembled === "" ? null : assembled;
}

function chunked<T>(values: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += MAX_ENTITY_DISPLAY_NAME_LOOKUP) {
    chunks.push(values.slice(start, start + MAX_ENTITY_DISPLAY_NAME_LOOKUP));
  }
  return chunks;
}

/**
 * The display identity of many entities, in one read per node table.
 *
 * An id the firm has no live row for is simply ABSENT from the answer rather than returned empty.
 * A handle nothing answers for is a fact the caller already knows how to render — it shows the gap —
 * and returning a row with a null name for it would make a deleted record indistinguishable from one
 * the firm holds under no name at all.
 *
 * A merged-away entity IS returned, carrying its merge pointer: a list row that names a folded record
 * has to say so, and hiding it would silently blank the column instead.
 */
export async function readEntityDisplayNames(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<EntityDisplayName[]> {
  const unique = [...new Set(entityIds)];
  const personIds = unique.filter((id) => id.startsWith("directoryPerson_"));
  const organizationIds = unique.filter((id) => id.startsWith("directoryOrganization_"));

  const byId = new Map<string, EntityDisplayName>();

  for (const chunk of chunked(personIds)) {
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, name_prefix, name_given, name_middle, name_family, name_suffix, display_name, merged_into_id
           FROM directory_person
          WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        name_prefix: string | null;
        name_given: string | null;
        name_middle: string | null;
        name_family: string | null;
        name_suffix: string | null;
        display_name: string | null;
        merged_into_id: string | null;
      }>();
    for (const row of results) {
      byId.set(row.id, {
        entityId: row.id,
        entityKind: "person",
        displayName: displayNameFromRow(row),
        mergedIntoId: row.merged_into_id,
      });
    }
  }

  for (const chunk of chunked(organizationIds)) {
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT id, legal_name, display_name, merged_into_id
           FROM directory_organization
          WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        legal_name: string | null;
        display_name: string | null;
        merged_into_id: string | null;
      }>();
    for (const row of results) {
      byId.set(row.id, {
        entityId: row.id,
        entityKind: "organization",
        displayName: displayNameFromRow(row),
        mergedIntoId: row.merged_into_id,
      });
    }
  }

  // The caller's own order, so a page of rows keeps the order it asked in.
  return unique.map((entityId) => byId.get(entityId)).filter((entry) => entry !== undefined);
}
