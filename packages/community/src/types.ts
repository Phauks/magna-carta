// The board's closed sets. Each one is a `const` tuple plus a type derived from it, so the runtime
// validator and the compiler read from the same list and a value can never be legal to one and not
// the other.

// Two post kinds on one board. A request asks the product to change and is votable and tracked; a
// question asks how to do something and is not — its ANSWERS are what gets voted on. They share a
// table because a question that turns out to be a missing capability is converted to a request in
// one action and carries its thread with it, which it could not do across two tables.
export const POST_KINDS = ["request", "question"] as const;
export type PostKind = (typeof POST_KINDS)[number];

// The request pipeline. A question has no status at all — not a status meaning "not applicable",
// but the absence of one, because a question has no position on a roadmap.
//
// `duplicate` is the merge terminal: the post's votes travel to the target and the post itself
// stays readable, pointing at where the conversation continued.
export const POST_STATUSES = [
  "future",
  "planned",
  "building_now",
  "beta",
  "completed",
  "not_on_the_roadmap",
  "duplicate",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// The status a triaged request starts in. A request arrives with no status at all — untriaged is
// distinguishable from "considered and put in the future pile", and the thirty-day triage clock
// counts the ones with no status.
export const DEFAULT_TRIAGED_STATUS: PostStatus = "future";

// The statuses that put a request on the public roadmap, in the order the columns read.
export const ROADMAP_STATUSES = ["planned", "building_now", "beta"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

// Declining is never a bare status. A reason from this closed set is required alongside prose,
// because a status used to end a conversation rather than to describe reality teaches a reader to
// distrust every other status on the board.
export const DECLINE_REASONS = [
  "out_of_scope",
  "conflicts_with_confidentiality",
  "already_possible",
  "too_few_firms_affected",
  "superseded_by_other_work",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

// What a reader may see of a post or a comment.
//
// `pending_first_write_review` holds a brand-new account's first post and first comment until a
// human approves them; after one approval the account writes freely. `hidden` is reversible and is
// what the remove-first posture produces. `removed` and `deleted_by_author` are terminal.
export const VISIBILITIES = [
  "pending_first_write_review",
  "published",
  "hidden",
  "removed",
  "deleted_by_author",
] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// The one visibility a reader who is not the author ever sees.
export const PUBLICLY_READABLE_VISIBILITY: Visibility = "published";

export const HIDDEN_REASONS = [
  "confidentiality_report",
  "confidentiality_detector",
  "spam_reports",
  "operator",
] as const;
export type HiddenReason = (typeof HIDDEN_REASONS)[number];

// Why a reader reported something.
//
// The two families behave differently and that difference is the whole of the moderation posture.
// `spam` and `abuse` need several reports from several different firms before anything is hidden,
// which bounds report abuse. `confidentiality` hides on the first report from anybody signed in,
// because waiting for a second reader to agree that a post names a client means waiting for the
// disclosure to be read twice.
export const FLAG_REASONS = ["confidentiality", "spam", "abuse"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export const FLAG_STATUSES = ["open", "upheld", "cleared"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

export const SUBJECT_KINDS = ["post", "comment"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const MODERATION_ACTIONS = [
  "approved_first_write",
  "hidden",
  "restored",
  "removed",
  "status_changed",
  "converted_to_request",
  "merged_as_duplicate",
  "archived",
  "write_barred",
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

// The only badge that exists at launch. It is the board's sole anti-impersonation control: display
// names are deliberately not unique, because making them unique would publish which names are
// already taken.
export const BADGES = ["none", "staff"] as const;
export type Badge = (typeof BADGES)[number];

// How a list of posts is ordered.
export const SORTS = ["trending", "top", "new"] as const;
export type Sort = (typeof SORTS)[number];

// How many separate firms must report a post for spam or abuse before it is hidden without a human
// looking. One firm cannot reach it by itself however many accounts it has, because the count is
// over distinct firms rather than over reports.
export const SPAM_REPORT_DISTINCT_FIRM_THRESHOLD = 3;

// A request with no vote in this long is archived, with a note. Archived, never deleted.
export const ARCHIVE_AFTER_DAYS = 365;

// A request must reach a status within this long of being posted. Nothing sits untriaged past it.
export const TRIAGE_DUE_DAYS = 30;
