// The community board's closed vocabularies: what kinds of post exist, which part of the software a
// post can be about, where a request stands, and what moderation has done to it. These are
// TypeScript-only — the control-plane columns carry no CHECK — because community_post is a parent
// table and a parent's CHECK cannot be widened without a rebuild. Adding a value is a change here.

// Two kinds of post on one board. A request asks for something new and is votable and on the
// roadmap; a question asks how to do something today, is not votable, and its answers are.
export const POST_KINDS = ["request", "question"] as const;
export type PostKind = (typeof POST_KINDS)[number];

// Every category is a part of the software. There is NO general, off-topic, practice-management or
// jurisdiction category, and that absence is the board's primary confidentiality control: a
// practice-advice question has nowhere to go, and the composer asks "which part of the software?"
// before anything is written. The identity model (real display names, firm never shown) depends on
// this holding — do not add a catch-all here.
export const PRODUCT_AREAS = [
  { slug: "trust-and-reconciliation", label: "Trust and reconciliation" },
  { slug: "billing-and-invoicing", label: "Billing and invoicing" },
  { slug: "time-and-costs", label: "Time and costs" },
  { slug: "matters-and-organisation", label: "Matters and organisation" },
  { slug: "directory-and-conflicts", label: "Directory and conflicts" },
  { slug: "documents-and-file-manager", label: "Documents and file manager" },
  { slug: "templates-and-automation", label: "Templates, merge fields and automation" },
  { slug: "discovery", label: "Discovery" },
  { slug: "custodian", label: "Custodian" },
  { slug: "calendar-and-docketing", label: "Calendar and docketing" },
  { slug: "client-portal", label: "Client portal" },
  { slug: "reports", label: "Reports" },
  { slug: "integrations-and-api", label: "Integrations and API" },
  { slug: "mobile-and-desktop", label: "Mobile and desktop" },
  { slug: "search", label: "Search" },
  { slug: "accessibility", label: "Accessibility" },
  { slug: "onboarding-and-migration", label: "Onboarding and migration" },
] as const;
export type ProductAreaSlug = (typeof PRODUCT_AREAS)[number]["slug"];
export const PRODUCT_AREA_SLUGS = PRODUCT_AREAS.map((area) => area.slug) as unknown as readonly [
  ProductAreaSlug,
  ...ProductAreaSlug[],
];

export function productAreaLabel(slug: string): string | undefined {
  return PRODUCT_AREAS.find((area) => area.slug === slug)?.label;
}

// Where a request stands. "new" is the untriaged state every request starts in, so the board never
// claims a decision nobody made; the rest are the reference product's six plus "duplicate". A
// question uses "new" until an answer is accepted, then "answered".
export const REQUEST_STATUSES = [
  "new",
  "future",
  "planned",
  "building-now",
  "beta",
  "completed",
  "not-on-the-roadmap",
  "duplicate",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const QUESTION_STATUSES = ["new", "answered"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type PostStatus = RequestStatus | QuestionStatus;

export const STATUS_LABELS: Record<PostStatus, string> = {
  new: "New",
  future: "Future",
  planned: "Planned",
  "building-now": "Building now",
  beta: "Beta",
  completed: "Completed",
  "not-on-the-roadmap": "Not on the roadmap",
  duplicate: "Duplicate",
  answered: "Answered",
};

// The roadmap is a filtered view of the board by status, not a second store. Its columns, in order.
// There is deliberately no target-date anywhere: a card can move backwards and a date would be a
// promise.
export const ROADMAP_COLUMNS = [
  "future",
  "planned",
  "building-now",
  "beta",
  "completed",
] as const satisfies readonly RequestStatus[];

// Declining a request needs a reason from this closed set AND prose. A status used to end a
// conversation, rather than to describe what happened, teaches readers to distrust every status.
export const DECLINE_REASONS = [
  "outside-the-product",
  "already-possible",
  "conflicts-with-a-safeguard",
  "not-feasible-now",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  "outside-the-product": "Outside what Magna Carta is for",
  "already-possible": "Already possible today",
  "conflicts-with-a-safeguard": "Would weaken a confidentiality or security safeguard",
  "not-feasible-now": "Not feasible for now",
};

// What moderation has done to a post or comment. Only "published" is ever shown to anyone but its
// author and the team.
export const MODERATION_STATES = ["published", "held", "hidden", "deleted", "removed"] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

// Why something is held before anyone sees it: the author's first contribution (pre-moderation), or
// the format detector found text shaped like client detail.
export const HELD_REASONS = ["first-post", "detector"] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

// A reader's report. One confidentiality flag hides at once; spam and abuse need several firms.
export const FLAG_REASONS = ["confidential", "spam", "abuse"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

// Spam and abuse reports from this many DISTINCT firms hide a post pending review. Bounded by firm so
// one firm's staff cannot hide a post between them.
export const SPAM_HIDE_DISTINCT_FIRMS = 3;

// Vote counts below this are shown as "fewer than 5", so an early post does not reveal that one
// particular firm voted for it.
export const VOTE_DISPLAY_FLOOR = 5;

export const SORT_ORDERS = ["trending", "top", "new"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

// The limits a post and a comment are held to.
export const TITLE_MAX_LENGTH = 140;
export const BODY_MAX_LENGTH = 8000;
export const COMMENT_MAX_LENGTH = 4000;
export const DISPLAY_NAME_MAX_LENGTH = 40;
