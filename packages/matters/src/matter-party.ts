import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId } from "@magna-carta/identifiers/types";

// WHO A MATTER IS FOR — the one derivation, owned by the matter shell because `matter_party` is its
// table. Every subsystem that needs to know whose money or whose bill a matter carries reads it from
// here: billing resolves an invoice's client this way and re-proves it in its fitness suite, and
// trust attributes a matter's client ledger this way and re-proves it in its own. A second
// resolution rule written somewhere else is a second answer to "whose money is this", and the two
// would disagree on exactly the matters where it matters.
//
// `matter.client_display_name` is display-only and is deliberately NOT the link: a ledger or an
// invoice attributed by a display string is one that cannot be tied back to a Directory entity.
//
// THE CLIENT IS A ROLE, NOT A COLUMN. A matter carries many parties — opposing party, witness,
// expert — and the client is the one whose `role` is exactly `client` and whose row is not
// soft-deleted. A matter may in principle carry more than one such row (co-clients); the EARLIEST
// wins, deterministically, so every subsystem that resolves the same matter resolves it to the same
// entity rather than to whichever row a query happened to return first.
export const MATTER_PARTY_CLIENT_ROLE = "client";

// The membership test, as SQL, for a fitness query that re-proves an attribution over stored rows.
// Both expressions are column references the caller supplies from its own FROM clause — never
// user-supplied text — so this composes into an EXISTS predicate without a bound parameter.
export function matterClientPartyExistsPredicate(
  matterExpression: string,
  entityExpression: string,
): string {
  return `EXISTS (SELECT 1 FROM matter_party p WHERE p.matter_id = ${matterExpression} AND p.role = '${MATTER_PARTY_CLIENT_ROLE}' AND p.deleted_at IS NULL AND p.entity_id = ${entityExpression})`;
}

// Cloudflare D1 caps bound parameters at 100 per query, so an IN-list is chunked at that width. The
// node:sqlite test substrate allows far more, which is exactly why the cap is stated rather than
// discovered: an oversized list passes every local test and fails only against production D1. The
// ledger states the same platform limit for its own reads in `packages/ledger/src/statements.ts`.
const MATTER_PARTY_READ_CHUNK_SIZE = 100;

// Batched over every matter a caller touches, in one read per chunk: a bill or a transfer spanning
// several of a client's matters would otherwise resolve the same link once per row. A matter with no
// client party is ABSENT from the map rather than mapped to null — the caller decides what the
// absence means, because "there is nobody to bill" and "there is nobody to attribute this money to"
// are different refusals.
export async function readMatterClientEntityIds(
  database: SqlDatabase,
  matterIds: readonly MatterId[],
): Promise<Map<string, string>> {
  const clientByMatter = new Map<string, string>();
  for (let start = 0; start < matterIds.length; start += MATTER_PARTY_READ_CHUNK_SIZE) {
    const chunk = matterIds.slice(start, start + MATTER_PARTY_READ_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const { results } = await database
      .prepare(
        `SELECT matter_id, entity_id FROM matter_party
          WHERE matter_id IN (${placeholders}) AND role = '${MATTER_PARTY_CLIENT_ROLE}' AND deleted_at IS NULL
          ORDER BY created_at, id`,
      )
      .bind(...chunk)
      .all<{ matter_id: string; entity_id: string }>();
    for (const row of results) {
      if (!clientByMatter.has(row.matter_id)) clientByMatter.set(row.matter_id, row.entity_id);
    }
  }
  return clientByMatter;
}

// One matter's client, or null when it has no client party. The same derivation as the batched read
// above — literally the same query, one identifier wide — so a single-matter caller can never end up
// with a different answer than a batched one.
export async function readMatterClientEntityId(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<string | null> {
  const clientByMatter = await readMatterClientEntityIds(database, [matterId]);
  return clientByMatter.get(matterId) ?? null;
}
