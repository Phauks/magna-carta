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

// A canonical UTC instant: exactly what Date.prototype.toISOString emits — a fixed three-digit
// fraction and a literal Z. The whole federated sort rests on this being the only shape stored.
export const CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
