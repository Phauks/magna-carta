// The event catalog — telemetry grows by ADDING a builder here, never by free-form logging. Each
// builder enumerates exactly its loggable fields (the three-class model: technical metadata always;
// opaque identifier handles allowed; content fields have no slot to exist in).
import { defineEvent } from "./event.ts";

// request.completed — one per served request (route TEMPLATE, never the concrete path, which can
// embed matter numbers).
export const requestCompleted = defineEvent("request.completed", [
  "route",
  "method",
  "status",
  "durationMs",
] as const);

// error.captured — an escaped exception. messageHead is the first slice of error.message; the
// scrubber backstops it (the message could carry user content).
export const errorCaptured = defineEvent("error.captured", [
  "errorId",
  "route",
  "method",
  "errorName",
  "messageHead",
] as const);

// outbox.swept — the relay sweep result, one per sweep (database + dispatched/failed/deadLettered
// counts). WIRED by the scheduled sweep: a successful pass emits this so sweep volume is observable,
// not just failures.
export const outboxSwept = defineEvent("outbox.swept", [
  "database",
  "dispatched",
  "failed",
  "deadLettered",
] as const);

// migration.applied — a per-database migration apply ({ database, tag }). DEFINED-FOR-WIRING seam:
// the producer is the provisioning migrate-to-head path (apps/api-worker/src/firm-provisioner-wiring.ts).
// The builder ships ahead of that wiring so the producer needs no catalog change. Not yet emitted.
export const migrationApplied = defineEvent("migration.applied", ["database", "tag"] as const);

// migration.arrivedOutOfOrder — a migration applied to a database that had already applied a
// LATER-tagged one ({ database, tag, ledgerHead }). Apply order is tag order, so this database met
// the pair in a different order than one provisioned afterwards will. Not a failure: the migration
// is applied and the schema is at head. It is emitted because this is the only moment the fact
// exists — the ledger it lands in is a set of tags, with nothing recording which arrived late — and
// because for two migrations that touch the same objects it is the only thing that would say which
// firms carry a different schema. One event per tag: fields are flat, so a list has no slot.
export const migrationArrivedOutOfOrder = defineEvent("migration.arrivedOutOfOrder", [
  "database",
  "tag",
  "ledgerHead",
] as const);

// email.sent — a transactional email send outcome (never the body).
export const emailSent = defineEvent("email.sent", ["messageClass", "outcome"] as const);

// incident.created — a user-reported incident landed (the diagnostics agent's future feed).
export const incidentCreated = defineEvent("incident.created", [
  "incidentId",
  "errorIdCount",
] as const);

// telemetry.scrubbed is a COUNTER, not an event — the scrub backstop bumps a counter, it does not
// log a per-trip event. The Workers logger records each trip via count("telemetry.scrubbed", …)
// — an Analytics Engine metric, the aggregatable tripwire signal. There is deliberately no event
// builder for it (a per-trip log line would be noise on the hot path).

// operation.failed — a caught error in a NON-request context (a cron sweep, a best-effort
// post-response sweep, an unguarded auth hook). The request path uses error.captured; this is its
// background counterpart, carrying the operation label instead of a route/method. messageHead is
// scrubbed by the logger.
export const operationFailed = defineEvent("operation.failed", [
  "operation",
  "errorName",
  "messageHead",
  "errorId",
] as const);

// outbox.deadLettered — the relay exhausted a message's delivery attempts and parked it (an
// operational outcome, not an error). ids + topic + attempts only — payloads are never logged
// (redact by default; the allowlist has no payload slot anyway).
export const outboxDeadLettered = defineEvent("outbox.deadLettered", [
  "scope",
  "outboxId",
  "topic",
  "attempts",
] as const);

// auth.denied — a route-specific auth guard refused a request. The platform-admin guard logs the
// denial CAUSE (the operator signal — `unconfigured`/`missing-header`/`mismatch`) against the same
// errorId the client receives, while the client still sees one field-identical 401. The allowlist is
// the redaction: there is NO field for the presented or configured key, so neither can ever be
// logged — the structural replacement for the raw console.error the guard used to reach for, which
// had no such slot discipline.
export const authDenied = defineEvent("auth.denied", ["cause", "route", "errorId"] as const);

// ingest.verdict — one per terminal ingest outcome (commit or quarantine). Redaction is structural:
// there is NO slot for file id, name, r2 key, or content — only the scan verdict and the outcome
// classification. This makes infected/quarantine rates observable without logging anything that
// identifies the file or its uploader.
export const ingestVerdict = defineEvent("ingest.verdict", [
  "outcome",
  "scanVerdict",
  "scanDetail",
  "quarantineReason",
] as const);

// usage.feature — a product-usage signal: a feature was reached (an authorized route mapped to it
// was served) or completed (an authoritative domain mutation for it occurred). Identifiers are
// pseudonymous HMAC handles, never raw ids; surface/userIdHash/appVersion are null when the emit
// site cannot supply them (server-derived reached/completed). No content slot exists.
export const usageFeature = defineEvent("usage.feature", [
  "feature",
  "phase",
  "surface",
  "firmIdHash",
  "userIdHash",
  "appVersion",
] as const);

// document.assembled — one per finished assembly job. Redaction is structural: there is NO slot for a
// template name, a matter identifier, a merge-field key, or a resolved value — only the outcome
// classification, an error code from a closed set, and how many fields the matter could not supply.
// That makes the "documents are being filed with holes in them" signal observable without any of the
// document's content, and the absent KEYS (never values) are recorded on the assembly row instead,
// which is per-firm data behind the firm-scoped data-access layer rather than cross-firm analytics.
export const documentAssembled = defineEvent("document.assembled", [
  "outcome",
  "reason",
  "absenceCount",
] as const);

// custody.movementRecorded — one per appended row of the physical-custody ledger. The redaction is
// structural: there is NO slot for a packet handle, a custody number, a location name, a borrower, or
// an item description. That matters more here than almost anywhere else — the register is a list of
// the most sensitive things a firm holds, and its metadata alone is a disclosure ("this firm holds an
// original will for Jane Smith" needs no document attached). What remains is the shape of the
// activity: which kind of event, which class of borrower, and whether a carrier was involved.
export const custodyMovementRecorded = defineEvent("custody.movementRecorded", [
  "kind",
  "borrowerKind",
  "hasShipment",
] as const);

// matterAssets.assetRecorded — one per asset added to a matter's register. The redaction is
// structural, exactly as the custody ledger's is and for the same reason: this register concentrates
// what a family owns and what it is worth, so there is NO slot for a description, an address, a
// parcel number, an entity name, an account suffix, or an amount. What remains is the shape of the
// activity: which class of thing, and whether it arrived one at a time or in a bulk entry (which is
// how "is quick entry actually being used" gets answered without reading a single row).
export const matterAssetRecorded = defineEvent("matterAssets.assetRecorded", [
  "class",
  "entryMode",
] as const);

// ── Natural-language document search ────────────────────────────────────────
//
// Three events, and none of them has a slot for a member's question or a passage of a document. A
// member's natural-language question about a client matter is privileged content and the fields
// below are identifiers, counts, and closed labels — there is no declared key any of it could
// travel in.

// search.naturalLanguage.hitDropped — a hit the managed index returned whose pointer FAILED
// re-authorization through the firm-scoped data-access layer, and was therefore dropped before any
// of its text was returned.
//
// THIS IS THE HIGHEST-SEVERITY SIGNAL IN THE FEATURE and is never a routine condition. The index is
// scoped by a metadata filter that is an optimization rather than a boundary, so a returned pointer
// the caller may not see means either that filter did not do what it was asked or that the index
// holds something the feed should never have produced — both platform defects of the most serious
// kind. `check` names which re-authorization step refused, so the two are distinguishable without
// anybody reading the document.
//
// The count of drops is never returned to the caller: "your query matched fourteen passages you are
// not permitted to see" is itself a disclosure, and a measurable one. It goes here instead, to the
// people who can act on it.
export const naturalLanguageHitDropped = defineEvent("search.naturalLanguage.hitDropped", [
  "matterId",
  "objectKey",
  "check",
] as const);

// search.naturalLanguage.instanceOperationFailed — a provisioning or teardown job could not do what
// it was asked. `operation` is provision | teardown; `reason` is the port's closed failure label.
// A teardown failure matters more than a provisioning one: a firm has withdrawn consent and the
// request to delete the managed index did not land, which is a thing somebody has to finish by hand.
export const naturalLanguageInstanceOperationFailed = defineEvent(
  "search.naturalLanguage.instanceOperationFailed",
  ["operation", "reason", "instanceName"] as const,
);

// search.naturalLanguage.feedReconciliationMismatch — the feed catalog and the bucket disagree.
// Either direction is an inconsistency worth raising: an object with no live catalog row means
// something reached the feed prefix outside the writer, or a recorded deletion never executed; a
// live row with no object means a write was recorded and the bytes are gone. Counts only — the keys
// themselves are in the catalog, which is where somebody investigating will look.
export const naturalLanguageFeedReconciliationMismatch = defineEvent(
  "search.naturalLanguage.feedReconciliationMismatch",
  ["objectsWithoutLiveRow", "liveRowsWithoutObject"] as const,
);

// ── A meeting's signaling room ───────────────────────────────────────────────
//
// WHY A MEETING NEEDS A STREAM OF ITS OWN. Everything else this platform records leaves a row
// behind: a failed import has a record, a dead-lettered message has a topic and an attempt count.
// A meeting leaves attendance and nothing else — the roster, the sessions, the tracks and the
// sockets are deleted when the meeting ends, by design — so a room of three hundred that went badly
// used to be a thing nobody could ask a question about afterwards. These events are the only
// durable trace, and they are what an operator reads when a firm says "the meeting broke".
//
// WHAT IS STRUCTURALLY ABSENT, and it is most of what a meeting contains. There is no field here
// for a display name, a track name, a session description, a chat line or a routing-service body.
// That is not restraint at the call sites: the allowlist gives none of them a slot, so a future
// edit cannot add one without adding it here first, where it would have to be argued for. What is
// left is identifiers the platform minted, counts, closed enums and instants — which is the same
// posture the custody and asset registers take, and for a sharper reason: the metadata of a law
// firm's meetings is a disclosure on its own.
//
// CORRELATED BY THE THREE HANDLES. `firmId` and `meetingId` are on every event in the family and
// `attendanceId` is on every one that is about a person — so a meeting is one query and a
// participant's whole passage through it is one filter. The correlation id is minted per event,
// because a room is not a request: it is woken by a frame, an alarm or a route and there is no
// enclosing unit of work for the three to share. The meeting is the join key, not the correlation.
//
// WHAT IS DELIBERATELY NOT RECORDED PER OCCURRENCE. Presence is relayed many times a second in a
// live discussion and a `sync` is answered on demand — one event each would be the hot-path work
// golden rule 10 forbids, and would cost more than the room does. Presence is recorded once per
// coalesced flush with the count it covered, and the room's read cost is SAMPLED rather than
// counted (see `meetings.room.storageReadBudget`).

/** A socket took a stay: somebody arrived, or the same person's browser came back. */
export const meetingRoomJoined = defineEvent("meetings.room.joined", [
  "firmId",
  "meetingId",
  "attendanceId",
  "medium",
  "hostRole",
  // Whether this socket went to the door rather than into the room, and whether it displaced one
  // that already held the stay. A rejoin is the shape behind most "my tile is black" reports.
  "waiting",
  "rejoined",
] as const);

/**
 * The welcome is on the wire, which is the instant a socket is in the room.
 *
 * `waitingSize` is the door list this welcome CARRIED, which is empty for anybody who is not running
 * the meeting — who is at the door is a list of people a host has not yet decided about, and the
 * room is not told. The room's own read of the door is not made for a non-host, so the alternative
 * would be a list read per join to fill a field.
 */
export const meetingRoomWelcomed = defineEvent("meetings.room.welcomed", [
  "firmId",
  "meetingId",
  "attendanceId",
  "rosterSize",
  "waitingSize",
] as const);

/** Tracks the routing service confirmed, counted by kind — never named. */
export const meetingRoomPublished = defineEvent("meetings.room.published", [
  "firmId",
  "meetingId",
  "attendanceId",
  "trackCount",
  "audioCount",
  "videoCount",
  // What the service would not carry. A non-zero here with a published count beside it is the
  // difference between "nobody can see them" and "they never offered a camera".
  "refusedCount",
] as const);

/** Somebody else's tracks forwarded to this browser: what it asked for against what it got. */
export const meetingRoomSubscribed = defineEvent("meetings.room.subscribed", [
  "firmId",
  "meetingId",
  "attendanceId",
  "requestedCount",
  "forwardedCount",
] as const);

/** A change of simulcast layer, and how much of it the service refused. */
export const meetingRoomLayerChanged = defineEvent("meetings.room.layerChanged", [
  "firmId",
  "meetingId",
  "attendanceId",
  "trackCount",
  "refusedCount",
] as const);

/**
 * The held-back presence transitions the alarm relayed, as ONE event per flush.
 *
 * `relayedCount` is the coalescing made visible: a room where it sits at one is a quiet meeting, and
 * a room where it is forty is a discussion the throttle is earning its place in.
 */
export const meetingRoomPresenceRelayed = defineEvent("meetings.room.presenceRelayed", [
  "firmId",
  "meetingId",
  "relayedCount",
] as const);

/**
 * REACTIONS RELAYED, and whether the room named the person or counted the room.
 *
 * `coalesced` is the branch made visible. False is one reaction in a room small enough for a bubble
 * on a face, and the count is one. True is a whole second of a large room's applause as a single
 * frame, and the count is what that frame covered — eleven people applauding is the number the
 * coalescing exists to be able to send. A stream where `coalesced` is true and the count sits at one
 * is a room paying for a bucket it does not need.
 *
 * There is no field for WHICH reaction and there will not be one: the vocabulary is six names, the
 * name says something about a person's opinion of what was just said, and the whole subsystem is
 * careful not to record the mechanics of a conversation.
 */
export const meetingRoomReactionsRelayed = defineEvent("meetings.room.reactionsRelayed", [
  "firmId",
  "meetingId",
  "reactionCount",
  "coalesced",
] as const);

/**
 * A chat message carried to the people in the room, as a COUNT OF SOCKETS and nothing else.
 *
 * The room is not the record here — the route is, and the row is already committed before this
 * happens — so what is worth recording is the only thing the route cannot see: whether the copy
 * reached anybody. A relay to zero sockets is an ordinary meeting nobody is connected to and a relay
 * to three hundred is a live room; a stream where the first is the only shape is a relay that has
 * stopped working, which is otherwise invisible because the poller covers for it.
 *
 * `redaction` tells the two acts apart. There is NO field for the message handle and none for its
 * body: what was said is the transcript's to hold, under the matter's own retention, and the
 * telemetry stream has different readers and a different retention from the record.
 */
export const meetingRoomMessageRelayed = defineEvent("meetings.room.messageRelayed", [
  "firmId",
  "meetingId",
  "recipientCount",
  "redaction",
] as const);

/**
 * A frame the room would not act on.
 *
 * The reason is the protocol's own closed vocabulary and the Error ID is the handle the member is
 * holding, so a support call quoting one lands on the frame that produced it. `frameType` is the
 * protocol's own enum; a frame too malformed to name one records the empty string.
 */
export const meetingRoomRefused = defineEvent("meetings.room.refused", [
  "firmId",
  "meetingId",
  "attendanceId",
  "reason",
  "errorId",
  "frameType",
] as const);

/** A socket went away and a grace period started — or was found already superseded. */
export const meetingRoomSocketLost = defineEvent("meetings.room.socketLost", [
  "firmId",
  "meetingId",
  "attendanceId",
  "waiting",
] as const);

/** The grace sweep closed stays whose own minute ran out — the roster's and the door's. */
export const meetingRoomSwept = defineEvent("meetings.room.swept", [
  "firmId",
  "meetingId",
  "participantCount",
  "waitingCount",
] as const);

/** A newer socket took a stay over, and the older ones were hung up on. */
export const meetingRoomSuperseded = defineEvent("meetings.room.superseded", [
  "firmId",
  "meetingId",
  "attendanceId",
  "socketCount",
] as const);

/** A host let people in from the door, counted per decision rather than per person. */
export const meetingRoomAdmitted = defineEvent("meetings.room.admitted", [
  "firmId",
  "meetingId",
  "admittedCount",
] as const);

/** A host turned people away at the door. */
export const meetingRoomDenied = defineEvent("meetings.room.denied", [
  "firmId",
  "meetingId",
  "deniedCount",
] as const);

/**
 * A microphone closed by a host, or the whole room's.
 *
 * `attendanceId` names the person muted and is null for the whole-room act, which carries its count
 * instead — a host clearing the floor in a room of three hundred is one event, not three hundred.
 */
export const meetingRoomMuted = defineEvent("meetings.room.muted", [
  "firmId",
  "meetingId",
  "attendanceId",
  "byAttendanceId",
  "scope",
  "mutedCount",
] as const);

/** A host put somebody out of the meeting. The record of WHO is the hosting route's audit row. */
export const meetingRoomRemoved = defineEvent("meetings.room.removed", [
  "firmId",
  "meetingId",
  "attendanceId",
] as const);

/** The door moved — shut or opened again. */
export const meetingRoomLocked = defineEvent("meetings.room.locked", [
  "firmId",
  "meetingId",
  "locked",
] as const);

/** The meeting is over, with the size it ended at. */
export const meetingRoomEnded = defineEvent("meetings.room.ended", [
  "firmId",
  "meetingId",
  "participantCount",
  "waitingCount",
] as const);

/**
 * The one alarm woke, and which of its jobs it found due.
 *
 * A room has exactly one alarm serving four deadlines, so "the alarm ran" says almost nothing on its
 * own: the jobs are what distinguishes a room sweeping a dropped connection from one flushing a
 * burst of presence, and an alarm that ran and did none of them is the shape of a deadline nobody
 * lowered — which is the one way this mechanism can spin.
 */
export const meetingRoomAlarmRan = defineEvent("meetings.room.alarmRan", [
  "firmId",
  "meetingId",
  "sweptParticipants",
  "sweptWaiting",
  "presenceFlushed",
  // How many reactions the wake sent on as one coalesced frame. Zero is the ordinary case — a bucket
  // exists only while somebody is reacting — and a non-zero is the wake the sub-second deadline was
  // armed for.
  "reactionsFlushed",
  "endedMarkerRetired",
  "rearmed",
] as const);

/**
 * WHAT ONE FRAME COST THE ROOM IN STORAGE, sampled.
 *
 * The room's whole design is a budget — the roster is read at most once per frame, because in a room
 * of three hundred that read is three hundred keys — and nothing was measuring whether it held. This
 * is the measurement: the list and get operations a frame of each kind spent. It is SAMPLED rather
 * than recorded per frame because a signal that costs as much as the thing it measures is not a
 * signal, and it is approximate under concurrency: the counters belong to the room, so two frames in
 * flight share their spend. It is a budget, never a ledger.
 */
export const meetingRoomStorageReadBudget = defineEvent("meetings.room.storageReadBudget", [
  "firmId",
  "meetingId",
  "frameType",
  "listCount",
  "getCount",
] as const);

/**
 * A browser's own account of how its connection is behaving.
 *
 * The numbers are the browser's measurement of itself — nothing on the server can take them, because
 * the media never crosses it. Rates, counts and one enum; there is no slot for a track, a name or a
 * description, and the frame that carries it is bounded field by field so an impossible claim is
 * refused at the parse rather than aggregated here.
 */
export const meetingRoomClientReport = defineEvent("meetings.room.clientReport", [
  "firmId",
  "meetingId",
  "attendanceId",
  "quality",
  "roundTripMilliseconds",
  "lossFraction",
  "jitterMilliseconds",
  "outboundRid",
  "outboundWidth",
  "outboundHeight",
  "outboundBitsPerSecond",
  "inboundCount",
] as const);

// The catalog's event names — derived from the builders themselves (each carries its `eventName`),
// so this registry cannot drift from the real builders and the uniqueness fitness test checks the
// actual catalog, not a hand-copied parallel list. Adding a builder above adds it here.
export const EVENT_NAMES = [
  requestCompleted,
  errorCaptured,
  outboxSwept,
  migrationApplied,
  migrationArrivedOutOfOrder,
  emailSent,
  incidentCreated,
  operationFailed,
  outboxDeadLettered,
  authDenied,
  ingestVerdict,
  usageFeature,
  documentAssembled,
  custodyMovementRecorded,
  matterAssetRecorded,
  naturalLanguageHitDropped,
  naturalLanguageInstanceOperationFailed,
  naturalLanguageFeedReconciliationMismatch,
  meetingRoomJoined,
  meetingRoomWelcomed,
  meetingRoomPublished,
  meetingRoomSubscribed,
  meetingRoomLayerChanged,
  meetingRoomPresenceRelayed,
  meetingRoomReactionsRelayed,
  meetingRoomMessageRelayed,
  meetingRoomRefused,
  meetingRoomSocketLost,
  meetingRoomSwept,
  meetingRoomSuperseded,
  meetingRoomAdmitted,
  meetingRoomDenied,
  meetingRoomMuted,
  meetingRoomRemoved,
  meetingRoomLocked,
  meetingRoomEnded,
  meetingRoomAlarmRan,
  meetingRoomStorageReadBudget,
  meetingRoomClientReport,
].map((builder) => builder.eventName);
