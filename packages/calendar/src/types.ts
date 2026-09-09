// The closed vocabularies of the case calendar, and the bounds every read is held inside.

// What the firm asserts about an event. There is deliberately no "missed" value: a status says what
// a person recorded, and nothing here derives one from a date.
export const MATTER_EVENT_STATUSES = ["scheduled", "occurred", "cancelled"] as const;
export type MatterEventStatus = (typeof MATTER_EVENT_STATUSES)[number];

// Grouping and iconography only. Nothing in this package branches on a category.
export const MATTER_EVENT_CATEGORIES = ["litigation", "transaction", "firm", "other"] as const;
export type MatterEventCategory = (typeof MATTER_EVENT_CATEGORIES)[number];

// A platform row's name and code are the shared vocabulary and immutable to a firm; a firm row is
// the firm's own.
export const MATTER_EVENT_TYPE_ORIGINS = ["platform", "firm"] as const;
export type MatterEventTypeOrigin = (typeof MATTER_EVENT_TYPE_ORIGINS)[number];

export const MATTER_EVENT_PARTICIPANT_KINDS = ["member", "entity", "external"] as const;
export type MatterEventParticipantKind = (typeof MATTER_EVENT_PARTICIPANT_KINDS)[number];

// A firm event shares the event shape (dates, times, zone, status) but answers the other half of
// "whose calendar is this on": the firm's, not any matter's. Same status vocabulary, same
// discipline — the status says what the firm asserts, nothing derives one.
export const FIRM_EVENT_STATUSES = MATTER_EVENT_STATUSES;
export type FirmEventStatus = MatterEventStatus;

// The firm-wide switch. An 'all_members' event is on everyone's calendar without enumerating
// everyone — a participant list decays with every hire, and a firm holiday that silently misses the
// newest associate is worse than none. A 'participants' event is on the calendars of the people
// listed.
export const FIRM_EVENT_AUDIENCES = ["all_members", "participants"] as const;
export type FirmEventAudience = (typeof FIRM_EVENT_AUDIENCES)[number];

// A closed platform enum, not a firm catalog: unlike event types, no jurisdiction-specific
// vocabulary exists for rooms and vehicles, and nothing branches on the kind beyond grouping and
// iconography. 'other' is the pressure valve.
export const FIRM_RESOURCE_KINDS = ["room", "vehicle", "equipment", "other"] as const;
export type FirmResourceKind = (typeof FIRM_RESOURCE_KINDS)[number];

// Closed and small, because the engine branches on 'continuance_of' (the chain rules) and on
// nothing else; everything a firm means beyond that goes in the note. 'related' is undirected in
// meaning though stored directed; readers render it symmetrically.
export const CALENDAR_EVENT_LINK_KINDS = ["continuance_of", "related"] as const;
export type CalendarEventLinkKind = (typeof CALENDAR_EVENT_LINK_KINDS)[number];

// Which side of the calendar a federated read covers: matter-anchored sources, firm-anchored
// sources, or both. The filter narrows the REGISTRY before any statement is built, exactly as a
// kind filter does.
export const CALENDAR_SCOPES = ["matter", "firm", "all"] as const;
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

// The continuance-chain walk's bound. A chain deeper than this is not a hearing anybody continued
// a hundred times — it is corrupt data, and the read refuses rather than walking it.
export const MAX_CONTINUANCE_CHAIN_DEPTH = 100;

// Where a deadline came from. `statutory_catalog` is reserved and unreachable: no verified
// jurisdiction-keyed catalog exists, so no caller can supply the entry key and version its shape
// check requires, and the create path refuses the source outright. The vocabulary lands now because
// widening a CHECK later means rebuilding the table.
export const MATTER_DEADLINE_SOURCES = ["member", "court_order", "statutory_catalog"] as const;
export type MatterDeadlineSource = (typeof MATTER_DEADLINE_SOURCES)[number];

// A deadline's lifecycle. Overdue is NOT here: it is a comparison against now, computed at read
// time, and nothing ever writes it.
export const MATTER_DEADLINE_STATES = ["open", "satisfied", "vacated", "superseded"] as const;
export type MatterDeadlineState = (typeof MATTER_DEADLINE_STATES)[number];

// How a timeline read is oriented relative to today. `all` is the matter timeline's default: the
// question "what has happened on this case" and "what is coming" are the same list read in one order.
export const TIMELINE_DIRECTIONS = ["past", "future", "all"] as const;
export type TimelineDirection = (typeof TIMELINE_DIRECTIONS)[number];

// The firm-wide calendar's window cap, as a REFUSAL rather than a silent clamp. A clamp is worse
// than a refusal here for the reason a truncated page is worse than an error: a caller that asked
// for three years and silently received one has no way to tell that from a firm with no events in
// years two and three. 366 days covers the longest window anybody plans against (a full year,
// including a leap year) and keeps a firm-wide read a bounded window walk.
export const MAX_CALENDAR_WINDOW_DAYS = 366;

// The upcoming-deadline read's horizon, capped on the same reasoning and the same way.
export const MAX_DEADLINE_HORIZON_DAYS = 366;

// A timeline page. Bounded so no single request can ask the merge to hold an unbounded number of
// per-source rows in memory: the merge reads pageSize + 1 from EVERY registered source.
export const MAX_TIMELINE_PAGE_SIZE = 100;
export const DEFAULT_TIMELINE_PAGE_SIZE = 50;

// A source's time column is either a civil date (YYYY-MM-DD) or a UTC instant. The distinction is
// declared rather than inferred because the merge compares sort keys AS TEXT, and only canonical
// instants sort chronologically that way — see the canonical-instant obligation in src/merge.ts.
export type TimeColumnShape = "instant" | "civilDate";

// The three shapes a calendar row is written in — the canonical UTC instant the federated sort
// rests on, the civil date, and the wall-clock time — all live in @magna-carta/civil-time. They are
// not restated here: a fourth copy of the instant shape is how a timeline starts sorting wrong.
