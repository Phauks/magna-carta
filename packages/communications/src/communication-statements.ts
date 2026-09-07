import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { CommunicationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type {
  CommunicationChannel,
  CommunicationDirection,
  CommunicationProducer,
  CommunicationScope,
} from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const COMMUNICATION_TABLE = "communication";

// THE GATE, and it is the one thing in this module worth reading before anything else.
//
// Every read here composes the visible-matter predicate, and it is a REQUIRED argument on each one
// rather than an option with a default — the notes precedent, for the notes reason.
//
// What is different here, and what the predicate alone does not cover: this table's matter_id is
// NULLABLE. The predicate is an EXISTS over `matter`, which is FALSE for a NULL matter id, so an
// unrouted row fails it. That is correct and it is not sufficient — it means the predicate silently
// decides the unrouted queue is invisible, and a later reader who wants that queue would be tempted
// to drop the predicate to get at it. So the NULL branch is expressed here, explicitly, as its own
// clause the caller must ask for by passing `includeUnrouted` — and the route only passes it when
// the member holds communications:reviewUnrouted. A read that wants both says so in one place.
function matterClauseFor(
  visibility: VisibleMatterPredicate,
  includeUnrouted: boolean,
): { condition: string; bindings: readonly unknown[] } {
  const routed = visibility.fragmentFor(`${COMMUNICATION_TABLE}.matter_id`);
  if (!includeUnrouted) return { condition: routed, bindings: visibility.bindings };
  return {
    condition: `(${COMMUNICATION_TABLE}.matter_id IS NULL OR ${routed})`,
    bindings: visibility.bindings,
  };
}

export interface CommunicationRow {
  readonly id: CommunicationId;
  readonly channel: CommunicationChannel;
  readonly direction: CommunicationDirection;
  readonly matter_id: MatterId | null;
  readonly counterparty_number: string;
  readonly counterparty_entity_id: string | null;
  readonly member_user_id: UserId | null;
  readonly occurred_at: string;
  readonly duration_seconds: number | null;
  readonly body: string | null;
  readonly summary: string | null;
  readonly producer: CommunicationProducer;
  readonly logged_by_user_id: UserId | null;
  readonly carrier_reference: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// The matter's title, number and STATUS, resolved by the read rather than kept as a second copy that
// could drift. The status is not decoration: the anchor may be an intake or a consultation, which
// are unnumbered, and somebody about to reply to a text needs to know which — what may be said to a
// prospect and to a client are different things. `matter_number` is null on exactly those, and the
// consultation's own tentative number is what a surface shows in its place.
export interface CommunicationWithMatterRow extends CommunicationRow {
  readonly matter_title: string | null;
  readonly matter_status: string | null;
  readonly matter_number: string | null;
  readonly consultation_number: string | null;
}

const COLUMNS = [
  "id",
  "channel",
  "direction",
  "matter_id",
  "counterparty_number",
  "counterparty_entity_id",
  "member_user_id",
  "occurred_at",
  "duration_seconds",
  "body",
  "summary",
  "producer",
  "logged_by_user_id",
  "carrier_reference",
  "created_at",
  "updated_at",
]
  .map((column) => `${COMMUNICATION_TABLE}.${column}`)
  .join(", ");

// LEFT JOIN, never an inner one: the whole point of the unrouted queue is the rows with no matter,
// and an inner join would drop exactly them while looking like it worked.
const MATTER_COLUMNS =
  "matter.title AS matter_title, matter.status AS matter_status, " +
  "matter.matter_number AS matter_number, matter.consultation_number AS consultation_number";
const MATTER_JOIN = `LEFT JOIN matter ON matter.id = ${COMMUNICATION_TABLE}.matter_id`;

export interface InsertCommunicationInput {
  readonly id: CommunicationId;
  readonly channel: CommunicationChannel;
  readonly direction: CommunicationDirection;
  readonly matterId: MatterId | null;
  readonly counterpartyNumber: string;
  readonly counterpartyEntityId: string | null;
  readonly memberUserId: UserId | null;
  readonly occurredAt: string;
  readonly durationSeconds: number | null;
  readonly body: string | null;
  readonly summary: string | null;
  readonly loggedByUserId: UserId;
  readonly now: string;
}

// A hand-logged call or message. `producer` is the literal 'member' rather than an argument: the
// carrier path writes its own statement when the adapter lands, and a shared insert taking the
// producer as a parameter is how a member row eventually gets written claiming to be a carrier one.
export function insertCommunicationStatement(
  database: SqlDatabase,
  input: InsertCommunicationInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${COMMUNICATION_TABLE} (id, channel, direction, matter_id, counterparty_number, ` +
        `counterparty_entity_id, member_user_id, occurred_at, duration_seconds, body, summary, ` +
        `producer, logged_by_user_id, carrier_reference, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'member', ?12, NULL, ?13, ?13)`,
    )
    .bind(
      input.id,
      input.channel,
      input.direction,
      input.matterId,
      input.counterpartyNumber,
      input.counterpartyEntityId,
      input.memberUserId,
      input.occurredAt,
      input.durationSeconds,
      input.body,
      input.summary,
      input.loggedByUserId,
      input.now,
    );
}

// FILING one onto a matter — the act that only exists on the firm-wide screen, because inside a
// matter the matter is already known. The statement names the row's current matter state in its
// WHERE so two people filing the same message in the same instant cannot both succeed: the second
// UPDATE matches nothing and the service reads back what actually happened.
export function routeCommunicationStatement(
  database: SqlDatabase,
  input: {
    readonly id: CommunicationId;
    readonly matterId: MatterId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNICATION_TABLE} SET matter_id = ?1, updated_at = ?2 ` +
        `WHERE id = ?3 AND matter_id IS NULL`,
    )
    .bind(input.matterId, input.now, input.id);
}

// UNFILING. The row returns to the queue rather than being deleted: what was said still happened,
// and a message taken off the wrong matter has to land somewhere a person will see it again.
export function unrouteCommunicationStatement(
  database: SqlDatabase,
  input: { readonly id: CommunicationId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${COMMUNICATION_TABLE} SET matter_id = NULL, updated_at = ?1 ` +
        `WHERE id = ?2 AND matter_id IS NOT NULL`,
    )
    .bind(input.now, input.id);
}

export function selectCommunicationStatement(
  database: SqlDatabase,
  id: CommunicationId,
  visibility: VisibleMatterPredicate,
  includeUnrouted: boolean,
): SqlStatement {
  const matterClause = matterClauseFor(visibility, includeUnrouted);
  return database
    .prepare(
      `SELECT ${COLUMNS}, ${MATTER_COLUMNS} FROM ${COMMUNICATION_TABLE} ${MATTER_JOIN} ` +
        `WHERE ${COMMUNICATION_TABLE}.id = ? AND ${matterClause.condition}`,
    )
    .bind(id, ...matterClause.bindings);
}

export async function readCommunication(
  database: SqlDatabase,
  id: CommunicationId,
  visibility: VisibleMatterPredicate,
  includeUnrouted: boolean,
): Promise<CommunicationWithMatterRow | undefined> {
  const { results } = await selectCommunicationStatement(
    database,
    id,
    visibility,
    includeUnrouted,
  ).all<CommunicationWithMatterRow>();
  return results[0];
}

// Finding a conversation again, matched against what was said and who it was with.
//
// A LIKE scan rather than an index, and the cost is bounded by the same page the caller already
// asked for. The number is in the search on purpose: "what did we say to 702-555-0143" is how people
// actually look for a text, more often than by remembering a phrase in it.
function searchConditionFor(
  search: string | undefined,
): { condition: string; bindings: readonly unknown[] } | undefined {
  const term = search?.trim();
  if (term === undefined || term.length === 0) return undefined;
  // The wildcards are the caller's text, not their instruction: a message about a 50% split must not
  // turn every following character into a match-anything.
  const escaped = term.replaceAll(/[\\%_]/gu, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  return {
    condition:
      `(${COMMUNICATION_TABLE}.body LIKE ? ESCAPE '\\' ` +
      `OR ${COMMUNICATION_TABLE}.summary LIKE ? ESCAPE '\\' ` +
      `OR ${COMMUNICATION_TABLE}.counterparty_number LIKE ? ESCAPE '\\')`,
    bindings: [pattern, pattern, pattern],
  };
}

export interface CommunicationListOptions {
  readonly cursor?: { readonly sortKey: string; readonly id: string };
  readonly limit: number;
  readonly visibility: VisibleMatterPredicate;
  // Whether the reader holds communications:reviewUnrouted. False narrows every read to rows that
  // already have a visible matter, whatever scope is asked for — so a member without the key cannot
  // reach the queue by naming it.
  readonly includeUnrouted: boolean;
  readonly scope?: CommunicationScope;
  readonly search?: string;
  readonly channel?: CommunicationChannel;
  readonly matterId?: MatterId;
  readonly counterpartyEntityId?: string;
}

// ORDERED BY WHEN IT HAPPENED, newest first, with the id as the tiebreaker so a cursor is stable
// when two messages share an instant — which they do constantly, because a carrier stamps a whole
// multipart message with one time.
export function selectCommunicationsStatement(
  database: SqlDatabase,
  options: CommunicationListOptions,
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (options.matterId !== undefined) {
    conditions.push(`${COMMUNICATION_TABLE}.matter_id = ?`);
    bindings.push(options.matterId);
  } else if (options.scope === "unrouted") {
    conditions.push(`${COMMUNICATION_TABLE}.matter_id IS NULL`);
  } else if (options.scope === "routed") {
    conditions.push(`${COMMUNICATION_TABLE}.matter_id IS NOT NULL`);
  }

  if (options.channel !== undefined) {
    conditions.push(`${COMMUNICATION_TABLE}.channel = ?`);
    bindings.push(options.channel);
  }

  if (options.counterpartyEntityId !== undefined) {
    conditions.push(`${COMMUNICATION_TABLE}.counterparty_entity_id = ?`);
    bindings.push(options.counterpartyEntityId);
  }

  const search = searchConditionFor(options.search);
  if (search !== undefined) {
    conditions.push(search.condition);
    bindings.push(...search.bindings);
  }

  if (options.cursor !== undefined) {
    conditions.push(
      `(${COMMUNICATION_TABLE}.occurred_at < ? OR (${COMMUNICATION_TABLE}.occurred_at = ? ` +
        `AND ${COMMUNICATION_TABLE}.id < ?))`,
    );
    bindings.push(options.cursor.sortKey, options.cursor.sortKey, options.cursor.id);
  }

  // LAST, and never optional. A matter-scoped read composes it too: naming a matter is a narrowing
  // the caller asked for, not a substitute for the one the platform requires.
  const matterClause = matterClauseFor(options.visibility, options.includeUnrouted);
  conditions.push(matterClause.condition);
  bindings.push(...matterClause.bindings);
  bindings.push(options.limit);

  return database
    .prepare(
      `SELECT ${COLUMNS}, ${MATTER_COLUMNS} FROM ${COMMUNICATION_TABLE} ${MATTER_JOIN} ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${COMMUNICATION_TABLE}.occurred_at DESC, ${COMMUNICATION_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

// How many rows are waiting in the unrouted queue — the number the sidebar row and the screen's own
// heading carry. Counted rather than derived from a page, because "50+" on a queue somebody is meant
// to empty is not an answer.
export function countUnroutedCommunicationsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT COUNT(*) AS count FROM ${COMMUNICATION_TABLE} WHERE matter_id IS NULL`,
  );
}

// The matter a filing names, checked before the write. Returns the status too, because an anchor
// need not be NUMBERED — an intake and a consultation are both real anchors — but it must be a
// matter the reader can see and one that is still taking work.
export interface RoutableMatterRow {
  readonly id: MatterId;
  readonly status: string;
}

export async function readRoutableMatter(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<RoutableMatterRow | undefined> {
  // ALIASED, and kept aliased after the predicate learned to defend itself.
  //
  // This read is where the shadowing bug was found: the predicate composed as an EXISTS over the
  // bare `matter`, so a query whose own FROM was also the bare `matter` let the subquery shadow it,
  // the correlation became `matter.id = matter.id` — true of every row — and the gate passed every
  // matter in the firm. That is fixed at the source now (the predicate aliases its own table), so
  // this alias is no longer what makes the correlation real. It stays because the query reads more
  // clearly for it, and because a read whose subject is "the matter being checked" is worth naming.
  const { results } = await database
    .prepare(
      `SELECT anchor.id, anchor.status FROM matter AS anchor WHERE anchor.id = ? AND ` +
        visibility.fragmentFor("anchor.id"),
    )
    .bind(matterId, ...visibility.bindings)
    .all<RoutableMatterRow>();
  return results[0];
}
