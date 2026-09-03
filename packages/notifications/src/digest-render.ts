import type { DigestCategoryCount, DigestComposition } from "./digest.ts";
import type { EmailDetailLevel, NotificationCategory, NotificationDigestCadence } from "./types.ts";

// THE CONTENT BOUNDARY — the one place in this subsystem where anything crosses out of the platform.
//
// Every other surface here is a row a member reads inside the product, behind their session, the
// chokepoint, and the visible-matter predicate. A row rendered to the wrong person there is a bug
// with a fix. What this file produces is a copy handed to infrastructure the platform does not
// control: retained by a provider the firm did not choose, indexed by a desktop client, backed up,
// forwarded, and rendered on a lock screen to whoever is looking.
//
// AND, DECISIVELY, IT CANNOT BE RE-FILTERED. The wall in this subsystem binds at read time precisely
// so that a member who loses access to a matter stops seeing its notifications. That works for every
// channel the platform can re-read. An email sent yesterday to somebody walled off the matter today
// is simply out there. The only content safe against a future access change is content that never
// depended on access in the first place — which is exactly what a per-category count is.
//
// SO: A SUMMARY STATES THE SHAPE OF THE QUEUE AND NEVER ITS CONTENTS.
//
// What a line may contain: a category label from the closed set in `types.ts`, and an integer.
// What it may NOT contain, and what no argument to any function here can carry: a matter title, a
// matter number, a client or party name, a document or file name, an email subject line, a deadline
// description or date, a custody number or item description, an amount, an invoice number, or the
// identity of anybody involved. A matter title is client-identifying by construction — firms name
// matters after the parties and the dispute — and a matter number is client-identifying to anyone
// holding a prior email, an invoice, or the firm's own file index, which for the population that
// ends up reading a forwarded work email is most of them. A count discloses nothing about a client;
// it discloses the recipient's own workload, to the recipient.
//
// The boundary is STRUCTURAL rather than a rule to be remembered: the only inputs these functions
// take are a closed category label, integers, a cadence label, and a base URL from deployment
// configuration. There is no parameter a caller could put a title in.
//
// `test/digest-render.test.ts` renders over a fixture whose matters carry deliberately identifying
// titles and numbers and fails if any of them reaches the output.

// The reader-facing name of each category. Enum labels, exhaustive by type so adding a category to
// the vocabulary fails here rather than mailing somebody the raw key.
const CATEGORY_LABELS: Readonly<Record<NotificationCategory, string>> = Object.freeze({
  deadlines: "Deadlines",
  calendar: "Calendar",
  tasks: "Tasks",
  trust: "Trust",
  billing: "Billing",
  documents: "Documents",
  custody: "Custody",
  email: "Email",
  conflicts: "Conflicts",
  jobs: "Jobs",
  security: "Security",
  system: "System",
});

const CADENCE_LABELS: Readonly<Record<NotificationDigestCadence, string>> = Object.freeze({
  daily: "daily",
  weekly: "weekly",
});

// The path the one link in the mail points at. A path and never a rendered subject: following it
// lands the reader inside their session, where every row is resolved through the access-checked
// reads that decide what they may see today rather than what they could see when this was composed.
export const DIGEST_DEEP_LINK_PATH = "/notifications";

// TEXT, NOT HTML, and it is a decision rather than a limitation. A counts-only summary has nothing
// HTML buys: it renders identically in every client, it cannot leak through a tracking pixel or a
// remote image fetch, and it keeps the send port's signature unchanged.
export interface RenderedDigest {
  readonly subject: string;
  readonly text: string;
}

export interface RenderDigestInput {
  readonly composition: DigestComposition;
  // The resolved level — the more cautious of the member's choice and the firm's ceiling. `off` never
  // reaches here (the caller sends nothing at all); `matter-number` is declared and unbuilt, and is
  // rendered as `counts-only` rather than refused, so a firm's stored ceiling is honoured at its
  // most private reading until the level ships.
  readonly detailLevel: Exclude<EmailDetailLevel, "off">;
  // The deployment's public origin, e.g. `https://app.example`. Configuration, never firm data.
  readonly appBaseUrl: string;
}

export function renderNotificationDigest(input: RenderDigestInput): RenderedDigest {
  const { composition } = input;
  const total = composition.totalCount;
  const noun = total === 1 ? "item needs" : "items need";
  const quantity = composition.atLeast ? `at least ${total}` : `${total}`;

  // FIXED AND MATTER-FREE. The count varies; nothing else does. A subject line is the part of an
  // email that renders on a lock screen and in a notification bar, so it is the last place a matter
  // could be named even if a body were allowed to.
  const subject = `Magna Carta — ${quantity} ${noun} your attention`;

  const breakdown = composition.counts.map(renderCategoryCount).join(" · ");
  const link = `${trimTrailingSlash(input.appBaseUrl)}${DIGEST_DEEP_LINK_PATH}`;

  const text = [
    breakdown,
    "",
    `Open your notifications: ${link}`,
    "",
    `This is your ${CADENCE_LABELS[composition.cadence]} summary. It carries counts only — never a matter, a client, a document, or a date — because email leaves the platform and cannot be withdrawn. Sign in to see what these are.`,
    "",
    "Change or switch off these emails in your notification settings.",
  ].join("\n");

  return { subject, text };
}

function renderCategoryCount(entry: DigestCategoryCount): string {
  return `${CATEGORY_LABELS[entry.category]} ${entry.count}`;
}

function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}
