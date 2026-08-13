// THE CATEGORY TAXONOMY, WHICH IS THE BOARD'S PRIMARY CONFIDENTIALITY CONTROL.
//
// Every category below is a part of the software. There is no general category, no off-topic
// category, no practice-management category, no ask-a-lawyer category, and no jurisdiction
// category — and their absence is a design commitment rather than an oversight or a starting point.
//
// The mechanism: a post cannot be created without a category, so every author is asked "which part
// of the software is this about" before they write a word. That reframes the question at the only
// moment reframing is cheap, and it means a practice-advice question — one with a client in it —
// has nowhere on this board to go. Structure does this work; rules, norms and moderation only clean
// up what structure lets through.
//
// Two things depend on the absence holding, and both fail quietly if a general category is ever
// added. The identity model shows a member's real name by default, which is only harmless because
// the subject is always the software. And the format-only content detector accepts a high false
// positive rate, which is only affordable because the traffic it scans is product questions. Adding
// one catch-all category invalidates both at once, which is why test/categories.test.ts asserts the
// absence rather than trusting it to be remembered.
export const CATEGORIES = [
  "trust_and_reconciliation",
  "billing_and_invoicing",
  "time_and_costs",
  "matters_and_organisation",
  "directory_and_conflicts",
  "documents_and_file_manager",
  "templates_merge_fields_and_automation",
  "discovery",
  "custodian",
  "calendar_and_docketing",
  "client_portal",
  "reports",
  "integrations_and_api",
  "mobile_and_desktop",
  "search",
  "accessibility",
  "onboarding_and_migration",
] as const;

export type Category = (typeof CATEGORIES)[number];

// The names a reader sees. Held here beside the keys so the two cannot drift and so the desktop
// shell and the web application render one list rather than two.
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  trust_and_reconciliation: "Trust and reconciliation",
  billing_and_invoicing: "Billing and invoicing",
  time_and_costs: "Time and costs",
  matters_and_organisation: "Matters and organisation",
  directory_and_conflicts: "Directory and conflicts",
  documents_and_file_manager: "Documents and file manager",
  templates_merge_fields_and_automation: "Templates, merge fields and automation",
  discovery: "Discovery",
  custodian: "Custodian",
  calendar_and_docketing: "Calendar and docketing",
  client_portal: "Client portal",
  reports: "Reports",
  integrations_and_api: "Integrations and API",
  mobile_and_desktop: "Mobile and desktop",
  search: "Search",
  accessibility: "Accessibility",
  onboarding_and_migration: "Onboarding and migration",
};

// The words a catch-all category would be called. Held as data rather than as a comment so the
// fitness test can assert against the list instead of against a reviewer's memory.
export const FORBIDDEN_CATCH_ALL_CATEGORY_WORDS = [
  "general",
  "other",
  "misc",
  "miscellaneous",
  "off_topic",
  "offtopic",
  "practice",
  "ask",
  "advice",
  "war_stories",
  "lounge",
  "random",
  "anything",
] as const;

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

export function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}
