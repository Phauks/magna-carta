import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  boundedFirmScopedSelect,
  boundedSelect,
  civilDateWindowConditions,
  instantWindowConditions,
  projectRow,
} from "./build.ts";
import {
  TimelineSourceRegistry,
  type SourceReadRequest,
  type TimelineScope,
  type TimelineSource,
} from "./registry.ts";

// The declared sources. Each is a read-side declaration — where the rows live, how to read a bounded
// page of them, and how to project one — and NOT a write-side obligation on the subsystem that owns
// them. Adding a source is one entry here: one statement builder, one projection, and one decision
// about whether the source has a non-privileged label. It is never a change to anybody's write path.

// The deep link a person follows to see the row itself, in the subsystem that owns it and behind
// that subsystem's own access gate. This is what lets an entry carry no content: the detail is one
// extra request for the ONE row somebody opened, rather than a redaction problem on every row of
// every page.
function matterSectionLink(
  section: string,
): (row: { matter_id: string | null; row_id: string }) => string {
  return (row) => `/matters/${row.matter_id ?? ""}/${section}?entry=${row.row_id}`;
}

// ---- the two recorded sources ----

// A litigation event. Its title and description are free text a person wrote about a proceeding and
// can name the people it concerns, so they are NOT projected: the label is the event's PLATFORM type
// code where it has one, which is a shared vocabulary term rather than anything about a case, and
// null for a type the firm invented (a firm-authored type name is free text like any other).
//
// A setting that was called off is its own KIND, `cancelledEvent`, rather than a status column the
// projection does not carry: a firm-wide calendar has to draw a vacated hearing struck, because a
// thing that was cancelled and a thing that never existed are different facts, and the status is a
// closed word that says nothing about the case. The row stays on the calendar either way.
const matterEventSource: TimelineSource = {
  key: "matterEvent",
  kinds: ["event", "cancelledEvent"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: true,
  buildStatements: (request) => {
    const window = civilDateWindowConditions(
      "matter_event.starts_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("matter_event.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    if (request.scope.memberUserId !== undefined) {
      // "On this member's calendar" means a participant, or the matter's responsible member —
      // resolved as a predicate in SQL, never by reading every event and discarding most of them.
      conditions.push(
        "(EXISTS (SELECT 1 FROM matter_event_participant WHERE matter_event_participant.event_id = matter_event.id AND matter_event_participant.member_user_id = ?)" +
          " OR EXISTS (SELECT 1 FROM matter AS responsible_matter WHERE responsible_matter.id = matter_event.matter_id AND responsible_matter.responsible_member_id = ?))",
      );
      bindings.push(request.scope.memberUserId, request.scope.memberUserId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "matter_event LEFT JOIN matter_event_type ON matter_event_type.id = matter_event.event_type_id",
        sortColumn: "matter_event.starts_on",
        idColumn: "matter_event.id",
        matterExpression: "matter_event.matter_id",
        kindExpression:
          "CASE WHEN matter_event.status = 'cancelled' THEN 'cancelledEvent' ELSE 'event' END",
        actorExpression: "matter_event.recorded_by",
        labelExpression:
          "CASE WHEN matter_event_type.origin = 'platform' THEN matter_event_type.code ELSE NULL END",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("matterEvent", matterSectionLink("calendar")),
};

// A deadline. The title, the authority note, and the reason it is no longer in force are all free
// text, so the label is the STATE — a closed vocabulary that says whether the firm still owes this
// and nothing about what it is. Overdue is deliberately absent from the label: it is a comparison
// against now, made where the reader is, and never a stored fact.
const matterDeadlineSource: TimelineSource = {
  key: "matterDeadline",
  kinds: ["deadline"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const window = civilDateWindowConditions(
      "matter_deadline.due_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("matter_deadline.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "matter_deadline",
        sortColumn: "matter_deadline.due_on",
        idColumn: "matter_deadline.id",
        matterExpression: "matter_deadline.matter_id",
        kindExpression: "'deadline'",
        actorExpression: "matter_deadline.recorded_by",
        labelExpression: "matter_deadline.state",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("matterDeadline", matterSectionLink("calendar")),
};

// ---- the directly matter-linked federated sources ----

// A helper for the many sources whose whole shape is "an instant column, a matter column, one kind".
function directInstantSource(options: {
  key: string;
  kind: string;
  table: string;
  from?: string;
  sortColumn: string;
  idColumn: string;
  matterColumn: string;
  actorExpression: string;
  labelExpression: string;
  declaresLabel: boolean;
  extraConditions?: readonly string[];
  section: string;
}): TimelineSource {
  return {
    key: options.key,
    kinds: [options.kind],
    visibilityAnchor: "matter",
    timeColumnShape: "instant",
    declaresLabel: options.declaresLabel,
    supportsMemberFilter: false,
    buildStatements: (request) => {
      const window = instantWindowConditions(
        options.sortColumn,
        request.scope.fromDate,
        request.scope.toDate,
      );
      const conditions = [...window.conditions, ...(options.extraConditions ?? [])];
      const bindings = [...window.bindings];
      if (request.scope.matterId !== undefined) {
        conditions.push(`${options.matterColumn} = ?`);
        bindings.push(request.scope.matterId);
      }
      return [
        boundedSelect(request.database, {
          request,
          from: options.from ?? options.table,
          sortColumn: options.sortColumn,
          idColumn: options.idColumn,
          matterExpression: options.matterColumn,
          kindExpression: `'${options.kind}'`,
          actorExpression: options.actorExpression,
          labelExpression: options.labelExpression,
          conditions,
          bindings,
        }),
      ];
    },
    project: projectRow(options.key, matterSectionLink(options.section)),
  };
}

// Mail filed to a matter. DECLARES NO LABEL: a subject line is privileged content, and putting one
// on a firm-wide read that spans every matter is precisely the disclosure the confidentiality
// discipline forbids. The row says a message was filed, when, and by whom; what it says is behind
// the link.
const emailFiledSource = directInstantSource({
  key: "emailFiled",
  kind: "emailFiled",
  table: "email_matter_link",
  sortColumn: "email_matter_link.created_at",
  idColumn: "email_matter_link.id",
  matterColumn: "email_matter_link.matter_id",
  actorExpression: "email_matter_link.linked_by",
  labelExpression: "NULL",
  declaresLabel: false,
  section: "email",
});

// A document assembled onto the matter. The outcome and the count of fields the matter supplied no
// value for are provenance about the RUN, never about the document's contents.
const documentAssemblySource = directInstantSource({
  key: "documentAssembly",
  kind: "documentAssembly",
  table: "document_assembly",
  sortColumn: "document_assembly.created_at",
  idColumn: "document_assembly.id",
  matterColumn: "document_assembly.matter_id",
  actorExpression: "document_assembly.requested_by",
  labelExpression:
    "COALESCE(document_assembly.outcome, document_assembly.status) || ' · ' || document_assembly.absent_field_count",
  declaresLabel: true,
  section: "files",
});

// A document on the matter file. The label is the DOCUMENT TYPE where the firm classified it — a
// catalog term — and never the file name, which is free text a person typed and routinely names a
// client. Soft-deleted rows are excluded: a document a firm deleted is not on its timeline.
const documentFiledSource = directInstantSource({
  key: "documentFiled",
  kind: "documentFiled",
  table: "file",
  from: "file LEFT JOIN document_type ON document_type.id = file.document_type_id",
  sortColumn: "file.created_at",
  idColumn: "file.id",
  matterColumn: "file.matter_id",
  actorExpression: "NULL",
  labelExpression: "document_type.name",
  declaresLabel: true,
  extraConditions: ["file.deleted_at IS NULL"],
  section: "files",
});

// A note written on the matter. DECLARES NO LABEL, and it is not close.
//
// A note body is the successor to a time entry's narrative as the most privileged free-text field in
// this platform, and its first eight words are frequently the whole disclosure — "Client admits she
// was driving" projected onto a read that spans every matter is the exact leak the label discipline
// exists to prevent. The entry says a note was written, on this matter, then, by them; the words are
// one authenticated request away behind the link.
//
// SORTED BY WHEN THE THING HAPPENED, falling back to the day the note was written. A note recording
// Tuesday's call belongs beside Tuesday's hearing rather than beside the Thursday somebody typed it,
// which is how every other record of something that happened is ordered here — an event by starts_on,
// a deadline by due_on, a time entry by work_date. The one source that orders by when the ROW was
// written is the audit log, and that is named as its weakness in the constant below it rather than
// treated as the house style.
//
// This is a civilDate source for that reason, and the fallback is a date cut from the created
// instant rather than the instant itself: mixing the two shapes in one column would sort a note
// typed at nine in the morning before a note that happened the same day, on nothing but the presence
// of a "T".
const matterNoteSource: TimelineSource = {
  key: "matterNote",
  kinds: ["matterNote"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: false,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const orderingDate = "COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10))";
    const window = civilDateWindowConditions(
      orderingDate,
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("matter_note.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "matter_note",
        sortColumn: orderingDate,
        idColumn: "matter_note.id",
        matterExpression: "matter_note.matter_id",
        kindExpression: "'matterNote'",
        actorExpression: "matter_note.author_user_id",
        labelExpression: "NULL",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("matterNote", matterSectionLink("notes")),
};

// Time and cost entries are the densest sources in the platform by row count and would dominate an
// unfiltered timeline. They are REGISTERED rather than omitted, so a firm that wants them can have
// them, and a calendar surface defaults them off through the ordinary kind filter — which is a user
// interface default, not a decision this schema or this registry makes for anybody.
const timeEntrySource: TimelineSource = {
  key: "timeEntry",
  kinds: ["timeEntry"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: true,
  buildStatements: (request) => {
    const window = civilDateWindowConditions(
      "time_entry.work_date",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("time_entry.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    if (request.scope.memberUserId !== undefined) {
      conditions.push("time_entry.timekeeper_user_id = ?");
      bindings.push(request.scope.memberUserId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "time_entry",
        sortColumn: "time_entry.work_date",
        idColumn: "time_entry.id",
        matterExpression: "time_entry.matter_id",
        kindExpression: "'timeEntry'",
        actorExpression: "time_entry.timekeeper_user_id",
        // The duration only. A time entry's narrative is the single most privileged free-text field
        // in the billing corpus and never leaves its own access-gated read.
        labelExpression: "time_entry.duration_minutes || ' min'",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("timeEntry", matterSectionLink("time")),
};

const costEntrySource: TimelineSource = {
  key: "costEntry",
  kinds: ["costEntry"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const window = civilDateWindowConditions(
      "cost_entry.incurred_date",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("cost_entry.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "cost_entry",
        sortColumn: "cost_entry.incurred_date",
        idColumn: "cost_entry.id",
        matterExpression: "cost_entry.matter_id",
        kindExpression: "'costEntry'",
        actorExpression: "cost_entry.created_by",
        // An amount in minor units with its currency: a business number, never a payee.
        labelExpression: "cost_entry.amount_minor || ' ' || cost_entry.currency",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("costEntry", matterSectionLink("costs")),
};

// A conflicts check run against this matter. The trigger is a closed vocabulary and the hit count is
// a number; neither says who was surfaced, which is the part a conflicts log gates.
const conflictsCheckSource = directInstantSource({
  key: "conflictsCheck",
  kind: "conflictsCheck",
  table: "conflicts_check",
  sortColumn: "conflicts_check.created_at",
  idColumn: "conflicts_check.id",
  matterColumn: "conflicts_check.subject_matter_id",
  actorExpression: "conflicts_check.actor_user_id",
  labelExpression:
    "conflicts_check.trigger || ' · ' || (SELECT COUNT(*) FROM conflicts_hit WHERE conflicts_hit.check_id = conflicts_check.id)",
  declaresLabel: true,
  section: "conflicts",
});

// ---- the matter's own lifecycle ----

// The ONLY thing this timeline reads out of the audit log, and it is read over a STRICT allowlist.
//
// The audit log is not the timeline's substrate, and this is the most important boundary in the
// package. It records when a row was WRITTEN, not when the thing HAPPENED — a custody movement
// back-dated to Friday and typed on Monday lands on Monday, and the whole question a case timeline
// answers is what transpired. Its subject column is untyped and holds whatever the writer thought
// the subject was, so most rows cannot be reached from a matter at all. Its event vocabulary is
// uncurated and unbounded by design, so a timeline built over it would show every settings change
// and every permission grant beside the hearing. And it is a compliance record with its own
// retention, redaction, and access posture, which must be able to change without the product's read
// surface changing with it.
//
// It is still the only home for one class of fact: a matter's own lifecycle, which exists as two
// nullable columns on `matter` and a trail here and NOWHERE ELSE. So exactly these four keys are
// read, and a key not on this list is not a timeline entry however it is spelled.
//
// `matter.created` is on the list beside `matter.opened` because the write path distinguishes them:
// a matter that is opened at creation writes only `created`, and `opened` is the separate
// prospective-to-open transition. A timeline that took `opened` alone would silently have no
// beginning for every matter a firm opened outright, which is most of them.
export const MATTER_LIFECYCLE_EVENT_KEYS = Object.freeze([
  "matter.created",
  "matter.opened",
  "matter.closed",
  "matter.reopened",
] as const);

const matterLifecycleSource: TimelineSource = {
  key: "matterLifecycle",
  kinds: MATTER_LIFECYCLE_EVENT_KEYS,
  visibilityAnchor: "matter",
  timeColumnShape: "instant",
  declaresLabel: false,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const window = instantWindowConditions(
      "audit_log.created_at",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const allowlistPlaceholders = MATTER_LIFECYCLE_EVENT_KEYS.map(() => "?").join(", ");
    const conditions = [...window.conditions, `audit_log.event IN (${allowlistPlaceholders})`];
    const bindings: unknown[] = [...window.bindings, ...MATTER_LIFECYCLE_EVENT_KEYS];
    if (request.scope.matterId !== undefined) {
      conditions.push("audit_log.subject_id = ?");
      bindings.push(request.scope.matterId);
    } else {
      // Without a matter in scope the subject column is untyped, so the read is confined to rows
      // whose subject really is a matter. Anything else in this table is somebody else's record.
      conditions.push("audit_log.subject_id LIKE 'matter\\_%' ESCAPE '\\'");
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "audit_log",
        sortColumn: "audit_log.created_at",
        idColumn: "audit_log.id",
        matterExpression: "audit_log.subject_id",
        kindExpression: "audit_log.event",
        actorExpression: "audit_log.actor_user_id",
        // The log's metadata is redacted JSON written for a compliance reader; none of it is a
        // label, and rendering any of it here would make the product's surface depend on the audit
        // record's shape.
        labelExpression: "NULL",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("matterLifecycle", matterSectionLink("overview")),
};

// ---- the join-reached sources ----

async function resolveMatterPacketIds(
  database: SqlDatabase,
  scope: TimelineScope,
): Promise<readonly string[]> {
  if (scope.matterId === undefined) return [];
  // A bounded pre-read: a matter has few packets, and this one small result binds the second read.
  // It is not an N+1 — it runs once per page, not once per row.
  const { results } = await database
    .prepare("SELECT id FROM custody_packet WHERE matter_id = ? LIMIT 200")
    .bind(scope.matterId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

async function resolveMatterTrustNodeIds(
  database: SqlDatabase,
  scope: TimelineScope,
): Promise<readonly string[]> {
  if (scope.matterId === undefined) return [];
  // At most one matter leaf per trust account, by the shipped unique index, so this is bounded by
  // the number of trust accounts the firm holds.
  const { results } = await database
    .prepare("SELECT id FROM trust_ledger_node WHERE matter_id = ? AND kind = 'matter' LIMIT 100")
    .bind(scope.matterId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

function inClausePlaceholders(keys: readonly string[]): string {
  return keys.map(() => "?").join(", ");
}

// The custody ledger, reached through the matter's packets. OCCURRED_AT, never recorded_at: the
// register separates the two precisely because they diverge, and a timeline built on the wrong one
// would systematically misdate every physical-world event in the system.
//
// The label is the custody number and the movement kind. Never an item description, an owner, or a
// borrower — the register's metadata alone is a disclosure ("this firm holds an original will for
// Jane Smith" needs no document attached).
const custodyMovementSource: TimelineSource = {
  key: "custodyMovement",
  kinds: [
    "logged",
    "itemized",
    "moved",
    "checked_out",
    "returned",
    "withdrawn",
    "released",
    "superseded",
    "destroyed",
    "lost",
    "found",
    "reviewed",
    "hold_placed",
    "hold_released",
    "correction",
  ],
  visibilityAnchor: "matter",
  timeColumnShape: "instant",
  declaresLabel: true,
  supportsMemberFilter: false,
  resolveJoinKeys: resolveMatterPacketIds,
  buildStatements: (request) => {
    // A matter with no packets matches nothing, so the source issues NO statement rather than one
    // that cannot hit — the read count stays honest and the batch stays small.
    if (request.scope.matterId !== undefined && (request.joinKeys ?? []).length === 0) return [];
    const window = instantWindowConditions(
      "custody_movement.occurred_at",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      const keys = request.joinKeys ?? [];
      conditions.push(`custody_movement.packet_id IN (${inClausePlaceholders(keys)})`);
      bindings.push(...keys);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "custody_movement JOIN custody_packet ON custody_packet.id = custody_movement.packet_id",
        sortColumn: "custody_movement.occurred_at",
        idColumn: "custody_movement.id",
        matterExpression: "custody_packet.matter_id",
        kindExpression: "custody_movement.kind",
        actorExpression: "custody_movement.recorded_by_user_id",
        labelExpression: "custody_packet.custody_number || ' · ' || custody_movement.kind",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("custodyMovement", matterSectionLink("custody")),
};

// The status predicates the custody register's own reads carry, restated here as named constants so
// the two sides are visibly the same rule rather than two rules that happen to agree today.
//
// A federated timeline that DISAGREES with the register it is built from is the one failure this
// package's whole design is meant to make unwritable, and the way it gets written is a source that
// filters on a date column and forgets the status column beside it. The custodian's own reads —
// `selectCustodyReviewsDueStatement` and `selectOverdueCustodyCheckoutsStatement` in
// packages/custodian/src — carry each of these with the reasoning attached; `test/source-fitness.ts`
// pairs every custody-derived source with the read it mirrors so a status added to either side
// cannot quietly land on only one.
//
// A released, destroyed, or lost packet is excluded: the firm no longer holds the property, and a
// review reminder for a will that left the safe is noise a calendar would train people to ignore.
const CUSTODY_PACKET_STILL_HELD = "custody_packet.status IN ('held', 'out')";
const CUSTODY_ITEM_STILL_HELD = "custody_item.status IN ('held', 'out')";

// Forward-looking custody: the dates a firm set to look at something again, over the hand-written
// partial indexes the reviews-due report already built. Two statements from one source, because a
// review date sits on a packet AND on an item and both are real.
const custodyReviewDueSource: TimelineSource = {
  key: "custodyReviewDue",
  kinds: ["packetReviewDue", "itemReviewDue"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const packetWindow = civilDateWindowConditions(
      "custody_packet.review_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const packetConditions = [
      ...packetWindow.conditions,
      "custody_packet.review_on IS NOT NULL",
      CUSTODY_PACKET_STILL_HELD,
    ];
    const packetBindings = [...packetWindow.bindings];
    const itemWindow = civilDateWindowConditions(
      "custody_item.review_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    // Both statuses, as the register's reviews-due read applies them: an item withdrawn from a packet
    // the firm still holds is as gone as a packet the firm released.
    const itemConditions = [
      ...itemWindow.conditions,
      "custody_item.review_on IS NOT NULL",
      CUSTODY_ITEM_STILL_HELD,
      CUSTODY_PACKET_STILL_HELD,
    ];
    const itemBindings = [...itemWindow.bindings];
    if (request.scope.matterId !== undefined) {
      packetConditions.push("custody_packet.matter_id = ?");
      packetBindings.push(request.scope.matterId);
      itemConditions.push("custody_packet.matter_id = ?");
      itemBindings.push(request.scope.matterId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "custody_packet",
        sortColumn: "custody_packet.review_on",
        idColumn: "custody_packet.id",
        matterExpression: "custody_packet.matter_id",
        kindExpression: "'packetReviewDue'",
        actorExpression: "NULL",
        labelExpression: "custody_packet.custody_number",
        conditions: packetConditions,
        bindings: packetBindings,
      }),
      boundedSelect(request.database, {
        request,
        from: "custody_item JOIN custody_packet ON custody_packet.id = custody_item.packet_id",
        sortColumn: "custody_item.review_on",
        idColumn: "custody_item.id",
        matterExpression: "custody_packet.matter_id",
        kindExpression: "'itemReviewDue'",
        actorExpression: "NULL",
        // The custody number and the item's ordinal inside its packet. Never the description, which
        // routinely names the person an instrument concerns.
        labelExpression: "custody_packet.custody_number || '-' || custody_item.ordinal",
        conditions: itemConditions,
        bindings: itemBindings,
      }),
    ];
  },
  project: projectRow("custodyReviewDue", matterSectionLink("custody")),
};

// When an original that went out is due back.
//
// Driven from the PACKET, not from the ledger. "Still out" is the selective fact — tens of packets
// against a movement ledger that grows without bound — so the read seeks the packets that are out and
// asks each one for its most recent check-out. Written the other way round, with the ledger as the
// outer table and the packet joined to it, the planner has only `item_id` and `due_back_on` to choose
// between and takes `item_id IS NULL`, which selects every packet-scoped movement the firm has ever
// recorded; the most-recent-check-out subquery then runs over all of them to answer a question whose
// answer is a handful of rows. The cost of that shape tracks the ledger's whole history rather than
// the number of things that are out, and it does not fall when the scope narrows to one matter.
const custodyDueBackSource: TimelineSource = {
  key: "custodyDueBack",
  kinds: ["dueBack"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: false,
  buildStatements: (request) => {
    const window = civilDateWindowConditions(
      "custody_movement.due_back_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    // The same predicates `selectOverdueCustodyCheckoutsStatement` carries, and for its reasons.
    // "Still out" is read off the PACKET, because the derived status and the movement that set it
    // commit in one batch — a packet that came back is not due back however overdue its old check-out
    // row once was. The due-back date then comes from that packet's MOST RECENT check-out, so a
    // back-dated correction to an old one cannot resurrect its deadline over a newer one.
    //
    // `kind` and `item_id` are asserted ONLY inside the join's subquery, which is what picks the
    // movement out. Repeating them here as well would say nothing new — a row the subquery returned
    // already satisfies both — while handing the planner a second, worse way into the table.
    const conditions = [
      ...window.conditions,
      "custody_movement.due_back_on IS NOT NULL",
      "custody_packet.status = 'out'",
    ];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      conditions.push("custody_packet.matter_id = ?");
      bindings.push(request.scope.matterId);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: `custody_packet JOIN custody_movement ON custody_movement.id = (
                 SELECT latest.id FROM custody_movement AS latest
                  WHERE latest.packet_id = custody_packet.id
                    AND latest.kind = 'checked_out'
                    AND latest.item_id IS NULL
                  ORDER BY latest.occurred_at DESC, latest.id DESC LIMIT 1)`,
        sortColumn: "custody_movement.due_back_on",
        idColumn: "custody_movement.id",
        matterExpression: "custody_packet.matter_id",
        kindExpression: "'dueBack'",
        actorExpression: "custody_movement.recorded_by_user_id",
        labelExpression: "custody_packet.custody_number",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("custodyDueBack", matterSectionLink("custody")),
};

// Client money on the matter, reached through the matter's trust ledger leaves. The label is the
// movement's kind, amount, and currency — a business number on a record the trust rules require the
// firm to keep. Never the counterparty, which is free text and frequently a person.
const trustMovementSource: TimelineSource = {
  key: "trustMovement",
  kinds: ["deposit", "disbursement", "matter_transfer"],
  visibilityAnchor: "matter",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: false,
  resolveJoinKeys: resolveMatterTrustNodeIds,
  buildStatements: (request) => {
    if (request.scope.matterId !== undefined && (request.joinKeys ?? []).length === 0) return [];
    const window = civilDateWindowConditions(
      "trust_movement.effective_date",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.matterId !== undefined) {
      const keys = request.joinKeys ?? [];
      // Both ends of a matter transfer: the receiving leaf's ledger must show a transfer in as
      // plainly as the source leaf shows it out.
      conditions.push(
        `(trust_movement.node_id IN (${inClausePlaceholders(keys)}) OR trust_movement.counterparty_node_id IN (${inClausePlaceholders(keys)}))`,
      );
      bindings.push(...keys, ...keys);
    }
    return [
      boundedSelect(request.database, {
        request,
        from: "trust_movement JOIN trust_ledger_node ON trust_ledger_node.id = trust_movement.node_id",
        sortColumn: "trust_movement.effective_date",
        idColumn: "trust_movement.id",
        matterExpression: "trust_ledger_node.matter_id",
        kindExpression: "trust_movement.kind",
        actorExpression: "trust_movement.recorded_by",
        labelExpression:
          "trust_movement.kind || ' · ' || trust_movement.amount_minor || ' ' || trust_movement.currency",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("trustMovement", matterSectionLink("trust")),
};

// ---- the firm's own scope ----

// The REVIEWED ALLOWLIST of firm-anchored sources — the other half of the visibilityAnchor
// declaration (see registry.ts). A source on this list composes NO visible-matter predicate,
// because its rows have no matter and are firm-visible by construction under the trusted-insider
// posture. Growing this list is a review decision with the same weight as loosening a predicate:
// the fitness pass fails on any firm-anchored source not named here, so the exemption can never be
// an accident of a forgotten argument.
export const FIRM_ANCHORED_SOURCE_KEYS = Object.freeze(["firmEvent"] as const);

// What the firm scheduled for itself, on the firm calendar beside everything else. The label is the
// catalog type name (a vocabulary term, the documentFiled discipline) and the audience — "Firm
// meeting · all_members" is renderable without disclosure. The TITLE stays off the federated read
// for the same reason every label is declared: "Discuss the Herrera write-down" is not the
// platform's to broadcast beyond the event's own access-gated read; detail follows the deep link.
//
// On a MATTER timeline this source returns no statements — a firm event is on no matter's history.
const firmEventSource: TimelineSource = {
  key: "firmEvent",
  kinds: ["firmEvent"],
  visibilityAnchor: "firm",
  timeColumnShape: "civilDate",
  declaresLabel: true,
  supportsMemberFilter: true,
  buildStatements: (request) => {
    if (request.scope.matterId !== undefined) return [];
    const window = civilDateWindowConditions(
      "firm_event.starts_on",
      request.scope.fromDate,
      request.scope.toDate,
    );
    const conditions = [...window.conditions];
    const bindings = [...window.bindings];
    if (request.scope.memberUserId !== undefined) {
      // "On this member's calendar" means: the member is a participant, OR the event's audience is
      // all_members — a firm holiday is on everyone's answer, which is the audience column's whole
      // point. Composed in SQL, never post-filtered.
      conditions.push(
        "(firm_event.audience = 'all_members'" +
          " OR EXISTS (SELECT 1 FROM firm_event_participant WHERE firm_event_participant.firm_event_id = firm_event.id AND firm_event_participant.member_user_id = ?))",
      );
      bindings.push(request.scope.memberUserId);
    }
    return [
      boundedFirmScopedSelect(request.database, {
        request,
        from: "firm_event LEFT JOIN matter_event_type ON matter_event_type.id = firm_event.event_type_id",
        sortColumn: "firm_event.starts_on",
        idColumn: "firm_event.id",
        kindExpression: "'firmEvent'",
        actorExpression: "firm_event.recorded_by",
        labelExpression: "COALESCE(matter_event_type.name || ' · ', '') || firm_event.audience",
        conditions,
        bindings,
      }),
    ];
  },
  project: projectRow("firmEvent", (row) => `/calendar/firm-events?entry=${row.row_id}`),
};

// The registry. Fourteen declarations, reviewed when the list changes — the read count per page
// scales with THIS, not with the firm's data.
export const TIMELINE_SOURCES: readonly TimelineSource[] = Object.freeze([
  matterEventSource,
  matterDeadlineSource,
  emailFiledSource,
  documentAssemblySource,
  documentFiledSource,
  matterNoteSource,
  timeEntrySource,
  costEntrySource,
  conflictsCheckSource,
  matterLifecycleSource,
  custodyMovementSource,
  custodyReviewDueSource,
  custodyDueBackSource,
  trustMovementSource,
  firmEventSource,
]);

export function timelineSourceRegistry(): TimelineSourceRegistry {
  return new TimelineSourceRegistry(TIMELINE_SOURCES);
}

// Re-exported so a caller building a bespoke read (a test, a measurement) composes the same request
// shape every source is written against.
export type { SourceReadRequest };
