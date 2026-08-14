import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  DIRECTORY_EDGE_CREATED_TOPIC,
  DIRECTORY_ENTITY_CREATED_TOPIC,
  DIRECTORY_ENTITY_MERGED_TOPIC,
  DIRECTORY_ENTITY_RENAMED_TOPIC,
  DIRECTORY_IDENTIFIER_ADDED_TOPIC,
  MATTER_PARTY_LINKED_TOPIC,
} from "@magna-carta/directory/topics";
import {
  MATTER_CREATED_TOPIC,
  MATTER_OPENED_TOPIC,
  MATTER_REOPENED_TOPIC,
} from "@magna-carta/matters/topics";
import type { ConflictsTrigger } from "./types.ts";

// AFFECTED-MATTER RESOLUTION — one function per topic, each a single bounded indexed query, and each
// answering exactly one question: which already-checked matters could this corpus change have changed
// the answer for?
//
// Everything here runs in a queue consumer. Nothing here may be called from a request handler: the
// whole point of putting one outbox row on the write path is that the fan-out happens somewhere a
// slow answer costs nobody a response.
//
// The lookups all walk matter_party_entity_id_index and matter's own primary key. A matter that is
// not live is deliberately excluded from the corpus-change triggers: a closed matter's parties stay
// findable BY other matters' checks (Rule 1.9 is about former clients), but the closed matter itself
// is not re-screened, and its posture read goes on reporting its last check verbatim.

// A firm-personnel change reaches every matter the firm currently has open, because imputation is an
// identity join over the whole roster rather than anything about one matter's parties.
const PERSONNEL_TOPIC = "member.provisioned";

// The member-provision mirror is the producer for PERSONNEL_TOPIC. Named here rather than imported
// because the producer is a worker consumer rather than a domain package; the worker's own test pins
// the two spellings together.
export const CONFLICTS_PERSONNEL_TOPIC = PERSONNEL_TOPIC;

// The topics that can cause a re-check, and the trigger each one records on the check that answers
// it. A topic absent from this table is not a cause — which is a statement, not an oversight, and
// section "what deliberately does not fire" of the design is the home of the reasoning.
const TRIGGER_BY_TOPIC: Readonly<Record<string, ConflictsTrigger>> = {
  [MATTER_CREATED_TOPIC]: "preliminary",
  [MATTER_OPENED_TOPIC]: "comprehensive",
  [MATTER_REOPENED_TOPIC]: "comprehensive",
  [MATTER_PARTY_LINKED_TOPIC]: "new_party",
  [DIRECTORY_ENTITY_MERGED_TOPIC]: "entity_merged",
  [DIRECTORY_ENTITY_RENAMED_TOPIC]: "entity_renamed",
  [DIRECTORY_EDGE_CREATED_TOPIC]: "relationship_recorded",
  [DIRECTORY_IDENTIFIER_ADDED_TOPIC]: "identifier_recorded",
  [PERSONNEL_TOPIC]: "personnel_changed",
};

// The catalogue the worker's per-firm dispatch table spreads, so adding a cause is one entry in the
// table above and nothing at all in the dispatcher.
export const RECHECK_CAUSE_TOPICS: readonly string[] = Object.freeze(Object.keys(TRIGGER_BY_TOPIC));

// The trigger a check answering this topic records. Falls back to `periodic_rescan` for a topic this
// build does not know, which is the honest label for "something asked and the reason is not in this
// catalogue" — never a silent drop of the cause.
export function triggerForCauseTopic(topic: string): ConflictsTrigger {
  return TRIGGER_BY_TOPIC[topic] ?? "periodic_rescan";
}

export interface ResolvedCause {
  // Every live matter this change could have changed the answer for. Never trimmed: a cap belongs on
  // how many are ATTEMPTED at once, never on how many are recorded, because a trimmed set is a
  // conflict that was noticed and then forgotten.
  readonly matterIds: readonly string[];
  // The handle the cause is about, and the coalescing key. Chosen per topic to be stable under
  // redelivery and distinct between genuinely different causes.
  readonly causeReference: string;
}

const NOTHING: ResolvedCause = { matterIds: [], causeReference: "" };

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Live matters naming any of the given entities as a party. One query over
// matter_party_entity_id_index joined to matter's primary key; deleted party links and closed matters
// are excluded, and the result is de-duplicated by the query rather than in JavaScript so an entity
// wearing several hats on one matter still produces one matter id.
async function liveMattersWithParties(
  database: SqlDatabase,
  entityIds: readonly string[],
): Promise<string[]> {
  const present = entityIds.filter((entityId) => entityId.length > 0);
  if (present.length === 0) return [];
  const placeholders = present.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT DISTINCT matter_party.matter_id AS matter_id
         FROM matter_party
         JOIN matter ON matter.id = matter_party.matter_id
        WHERE matter_party.entity_id IN (${placeholders})
          AND matter_party.deleted_at IS NULL
          AND matter.status IN ('prospective', 'open')
          AND matter.system_key IS NULL
        ORDER BY matter_party.matter_id ASC`,
    )
    .bind(...present)
    .all<{ matter_id: string }>();
  return results.map((row) => row.matter_id);
}

// Live matters reached from a newly recorded edge: either endpoint being a party, plus a matter whose
// party sits one hop away across the new edge. One hop is what the shipped expansion reaches, so this
// resolution and the check that answers it agree about what "within budget" means; when the typed
// per-edge-class budgets land, this walk widens with them.
async function liveMattersNearEdge(
  database: SqlDatabase,
  fromEntityId: string,
  toEntityId: string,
): Promise<string[]> {
  const direct = await liveMattersWithParties(database, [fromEntityId, toEntityId]);
  const { results } = await database
    .prepare(
      `SELECT DISTINCT matter_party.matter_id AS matter_id
         FROM directory_edge
         JOIN matter_party
           ON matter_party.entity_id = CASE
                WHEN directory_edge.from_entity_id IN (?1, ?2) THEN directory_edge.to_entity_id
                ELSE directory_edge.from_entity_id
              END
         JOIN matter ON matter.id = matter_party.matter_id
        WHERE (directory_edge.from_entity_id IN (?1, ?2) OR directory_edge.to_entity_id IN (?1, ?2))
          AND directory_edge.deleted_at IS NULL
          AND matter_party.deleted_at IS NULL
          AND matter.status IN ('prospective', 'open')
          AND matter.system_key IS NULL
        ORDER BY matter_party.matter_id ASC`,
    )
    .bind(fromEntityId, toEntityId)
    .all<{ matter_id: string }>();
  return [...new Set([...direct, ...results.map((row) => row.matter_id)])].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

// Every live matter, for a firm-personnel change. Imputation is a join against the firm's roster, so
// a new member can change the answer on a matter whose parties never moved at all. The whole set is
// returned; how much of it is attempted at once is the caller's budget, not this function's.
async function allLiveMatters(database: SqlDatabase): Promise<string[]> {
  const { results } = await database
    .prepare(
      `SELECT id FROM matter
        WHERE status IN ('prospective', 'open') AND system_key IS NULL
        ORDER BY id ASC`,
    )
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

// The one entry point: a topic and its (already-parsed) outbox payload in, the affected matter set
// and the coalescing key out. Unknown topics and structurally unusable payloads resolve to nothing
// rather than throwing — the caller acks them, because a redelivery of a payload that will never
// parse can only march a permanent error to a dead-letter queue.
export async function resolveAffectedMatters(
  database: SqlDatabase,
  topic: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<ResolvedCause> {
  switch (topic) {
    case MATTER_CREATED_TOPIC:
    case MATTER_OPENED_TOPIC:
    case MATTER_REOPENED_TOPIC: {
      // The matter names itself. A matter with no party yet still records a request: the check that
      // answers it searches an empty party set and says so, which is a report, and the alternative —
      // deciding here that there is nothing worth searching — would be the resolver forming an
      // opinion about a matter it has not read.
      const matterId = stringField(payload, "matterId");
      if (matterId === null) return NOTHING;
      return { matterIds: [matterId], causeReference: matterId };
    }
    case MATTER_PARTY_LINKED_TOPIC: {
      const matterId = stringField(payload, "matterId");
      const entityId = stringField(payload, "entityId");
      if (matterId === null || entityId === null) return NOTHING;
      // Keyed on the ENTITY rather than the link row: linking the same entity twice in two roles, or
      // the unlink-then-link a role change is expressed as, is one question about one entity.
      return { matterIds: [matterId], causeReference: entityId };
    }
    case DIRECTORY_ENTITY_MERGED_TOPIC: {
      const masterId = stringField(payload, "masterId");
      const subordinateId = stringField(payload, "subordinateId");
      if (masterId === null || subordinateId === null) return NOTHING;
      // Matters that named EITHER side. Two records that were separately unremarkable are now one
      // record whose union may not be, and the matter that named only the subordinate is exactly the
      // one whose answer the merge could have changed.
      const matterIds = await liveMattersWithParties(database, [masterId, subordinateId]);
      // The subordinate is the stable key: an entity can be merged away only once, so a redelivery
      // collapses and a second, different merge into the same master is its own cause.
      return { matterIds, causeReference: subordinateId };
    }
    case DIRECTORY_ENTITY_RENAMED_TOPIC: {
      const entityId = stringField(payload, "entityId");
      if (entityId === null) return NOTHING;
      return {
        matterIds: await liveMattersWithParties(database, [entityId]),
        causeReference: entityId,
      };
    }
    case DIRECTORY_IDENTIFIER_ADDED_TOPIC: {
      const entityId = stringField(payload, "entityId");
      const identifierId = stringField(payload, "identifierId");
      if (entityId === null || identifierId === null) return NOTHING;
      // Keyed on the identifier ROW: two identifiers arriving for one entity are two chances for an
      // exact-identifier match, and collapsing them onto the entity would lose the second.
      return {
        matterIds: await liveMattersWithParties(database, [entityId]),
        causeReference: identifierId,
      };
    }
    case DIRECTORY_EDGE_CREATED_TOPIC: {
      const edgeId = stringField(payload, "edgeId");
      const fromEntityId = stringField(payload, "fromEntityId");
      const toEntityId = stringField(payload, "toEntityId");
      if (edgeId === null || fromEntityId === null || toEntityId === null) return NOTHING;
      return {
        matterIds: await liveMattersNearEdge(database, fromEntityId, toEntityId),
        causeReference: edgeId,
      };
    }
    case PERSONNEL_TOPIC: {
      const userId = stringField(payload, "userId");
      if (userId === null) return NOTHING;
      return { matterIds: await allLiveMatters(database), causeReference: userId };
    }
    case DIRECTORY_ENTITY_CREATED_TOPIC:
      // DELIBERATELY NOTHING. A newly created Directory entity cannot change any existing matter's
      // answer until something links it to a matter or connects it by an edge — and both of those
      // arrive here as their own topics. Firing on creation would make a two-thousand-row contact
      // import re-screen the firm's entire open caseload for no possible new hit, which is how a
      // backstop becomes a thing people switch off.
      return NOTHING;
    default:
      return NOTHING;
  }
}
