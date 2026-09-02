/*
 * The matter's section map — the one list the section nav and the section pages read. Each
 * section carries a maturity stage (maturity.ts): the nav shows its badge, and a "soon" section
 * lands on an honest stub describing what will live there. The stage climbs (soon → alpha → beta
 * → ready) as the section's real surface is built out.
 *
 * Each section also declares whether the matter's consolidated search can answer from it — a
 * source key, or `null` with the one line naming what a source there waits on. It is REQUIRED
 * either way, and `pnpm run lint:matter-search-coverage` fails a section that declares neither.
 * That is what makes the search's growth impossible to forget rather than merely unlikely: adding
 * a fifteenth section forces somebody to answer the question, and the scope dropdown renders the
 * unanswerable ones disabled with their reason instead of quietly omitting them.
 */
import type { MaturityStage } from "$lib/maturity/maturity.ts";

export interface MatterSection {
  /** Route segment under matters/[id]/. */
  slug: string;
  label: string;
  /** Core sections stay visible in the tab strip; the rest fold into "More" first. */
  core: boolean;
  /** Where this section is on the build ladder; drives its nav badge. */
  stage: MaturityStage;
  /** One paragraph, product voice: what lives here once the section is real. */
  description: string;
  /**
   * The matter-search source key that answers for this section, or null when none does yet.
   * The key must match a source registered in @magna-carta/matter-search.
   */
  searchSource: string | null;
  /**
   * Required when `searchSource` is null: the one honest line the disabled scope option carries.
   * Names what a source here waits on, in the reader's words.
   */
  searchWaitingOn?: string;
}

export const matterSections: readonly MatterSection[] = [
  {
    slug: "overview",
    label: "Overview",
    core: true,
    stage: "alpha",
    description: "The matter at a glance — its facts, status, and what has accrued against it.",
    // Deliberately never a source rather than one that is merely unbuilt: the overview holds no
    // record of its own, it summarises what the other sections hold. A source here would answer
    // the same query twice and put a reader on a summary when they asked for the thing itself.
    searchSource: null,
    searchWaitingOn: "Overview summarises the other sections; searching it would answer twice",
  },
  {
    slug: "files",
    label: "Files",
    core: true,
    stage: "alpha",
    description:
      "The matter's versioned file record — every document the firm holds for this matter, " +
      "organized in folders, each version kept and each byte's integrity hash recorded.",
    searchSource: "files",
  },
  {
    slug: "time",
    label: "Time",
    core: true,
    stage: "alpha",
    description:
      "Time captured on this matter — timers, manual entries, and the weekly grid all land " +
      "here, billable or not.",
    searchSource: "time",
  },
  {
    slug: "costs",
    label: "Costs",
    core: true,
    stage: "alpha",
    description:
      "Costs advanced and expenses incurred for this matter — filing fees, service, experts — " +
      "with their recoverable and billable treatment.",
    searchSource: "costs",
  },
  {
    slug: "fees",
    label: "Fees",
    core: true,
    stage: "alpha",
    description:
      "Flat charges for professional services recorded on this matter — the fee agreement and " +
      "the work-in-progress fee ledger, waiting to be claimed by a bill.",
    searchSource: null,
    // Three different things are called a fee, and none of them is searchable text on this
    // section. The fee AGREEMENT (matter_billing_arrangement) carries amounts, enums and dates and
    // no free text at all. A billed fee is an invoice line, and the billing source already finds
    // it. What the Fees tab is designed around — a fee as its own dated work-in-progress record,
    // with a description — has no table and no route; the screen's own gap register says so.
    searchWaitingOn:
      "Fees you have billed are under Billing; an unbilled fee record does not exist yet",
  },
  {
    slug: "billing",
    label: "Billing",
    core: true,
    stage: "alpha",
    description:
      "Invoices, payments, and the matter's billing arrangement — hourly, flat fee, or " +
      "contingency — with the full accounting of what has been billed and collected.",
    searchSource: "billing",
  },
  {
    slug: "parties",
    label: "Parties",
    core: true,
    stage: "alpha",
    description:
      "Every person and organization connected to this matter — clients, opposing parties, " +
      "counsel, courts — linked from the firm Directory with conflict-aware roles.",
    searchSource: "parties",
  },
  {
    slug: "notes",
    label: "Notes",
    core: false,
    stage: "alpha",
    description: "Matter notes and memoranda — dated, attributed, and searchable.",
    searchSource: "notes",
  },
  {
    slug: "trust",
    label: "Trust",
    core: false,
    stage: "soon",
    description:
      "The matter's trust ledger — client funds held, disbursed, and reconciled under the " +
      "governing jurisdiction's rules. Fees never touch trust until earned.",
    searchSource: null,
    searchWaitingOn: "The Trust section itself is not built yet",
  },
  {
    slug: "custodian",
    label: "Custodian",
    core: false,
    stage: "alpha",
    description:
      "Physical items in the firm's custody for this matter — original wills, deeds, media — " +
      "tracked to a location, safe, and box.",
    searchSource: "custody",
  },
  {
    slug: "messaging",
    label: "Messaging",
    core: false,
    stage: "soon",
    description:
      "Secure messages exchanged with the client through the portal, kept on the matter record.",
    searchSource: null,
    searchWaitingOn: "The Messaging section itself is not built yet",
  },
  {
    slug: "emails",
    label: "Emails",
    core: false,
    stage: "soon",
    description: "Email correspondence filed to this matter, threaded and searchable.",
    searchSource: null,
    searchWaitingOn: "The Emails section itself is not built yet",
  },
  {
    slug: "calendar",
    label: "Calendar",
    core: false,
    stage: "alpha",
    description:
      "Hearings, depositions, and the dates this matter is held to. Each one is recorded by a " +
      "person, read in its own time zone, and reports when it has passed.",
    searchSource: "calendar",
  },
  {
    slug: "other",
    label: "Other",
    core: false,
    stage: "soon",
    description:
      "Everything else the matter accumulates — research, tasks, and tool output — finds its " +
      "home here.",
    searchSource: "matterAssets",
  },
];

/** The section a matter route is on, resolved from the address. Undefined off a section path. */
export function sectionForPathname(matterId: string, pathname: string): MatterSection | undefined {
  const root = `/matters/${matterId}`;
  if (pathname === root || pathname === `${root}/`) {
    return matterSections.find((section) => section.slug === "overview");
  }
  return matterSections.find(
    (section) =>
      pathname === `${root}/${section.slug}` || pathname.startsWith(`${root}/${section.slug}/`),
  );
}
