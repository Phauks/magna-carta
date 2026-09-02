/*
 * The matter's section map — the one list the section nav and the section pages read. Each
 * section carries a maturity stage (maturity.ts): the nav shows its badge, and a "soon" section
 * lands on an honest stub describing what will live there. The stage climbs (soon → alpha → beta
 * → ready) as the section's real surface is built out.
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
}

export const matterSections: readonly MatterSection[] = [
  {
    slug: "overview",
    label: "Overview",
    core: true,
    stage: "alpha",
    description: "The matter at a glance — its facts, status, and what has accrued against it.",
  },
  {
    slug: "activity",
    label: "Activity",
    core: true,
    stage: "alpha",
    description:
      "What has happened on this case, in order, from every part of the platform that records " +
      "anything \u2014 mail filed, documents, hearings and deadlines, time and costs, client money, " +
      "items in custody, and the notes the firm wrote about all of it.",
  },
  {
    slug: "files",
    label: "Files",
    core: true,
    stage: "alpha",
    description:
      "The matter's versioned file record — every document the firm holds for this matter, " +
      "organized in folders, each version kept and each byte's integrity hash recorded.",
  },
  {
    slug: "time",
    label: "Time",
    core: true,
    stage: "alpha",
    description:
      "Time captured on this matter — timers, manual entries, and the weekly grid all land " +
      "here, billable or not.",
  },
  {
    slug: "costs",
    label: "Costs",
    core: true,
    stage: "alpha",
    description:
      "Costs advanced and expenses incurred for this matter — filing fees, service, experts — " +
      "with their recoverable and billable treatment.",
  },
  {
    slug: "fees",
    label: "Fees",
    core: true,
    stage: "alpha",
    description:
      "Flat charges for professional services recorded on this matter — the fee agreement and " +
      "the work-in-progress fee ledger, waiting to be claimed by a bill.",
  },
  {
    slug: "billing",
    label: "Billing",
    core: true,
    stage: "alpha",
    description:
      "Invoices, payments, and the matter's billing arrangement — hourly, flat fee, or " +
      "contingency — with the full accounting of what has been billed and collected.",
  },
  {
    slug: "parties",
    label: "Parties",
    core: true,
    stage: "alpha",
    description:
      "Every person and organization connected to this matter — clients, opposing parties, " +
      "counsel, courts — linked from the firm Directory with conflict-aware roles.",
  },
  {
    slug: "notes",
    label: "Notes",
    core: false,
    stage: "alpha",
    description: "Matter notes and memoranda — dated, attributed, and searchable.",
  },
  {
    slug: "trust",
    label: "Trust",
    core: false,
    stage: "soon",
    description:
      "The matter's trust ledger — client funds held, disbursed, and reconciled under the " +
      "governing jurisdiction's rules. Fees never touch trust until earned.",
  },
  {
    slug: "custodian",
    label: "Custodian",
    core: false,
    stage: "alpha",
    description:
      "Physical items in the firm's custody for this matter — original wills, deeds, media — " +
      "tracked to a location, safe, and box.",
  },
  {
    slug: "messaging",
    label: "Messaging",
    core: false,
    stage: "soon",
    description:
      "Secure messages exchanged with the client through the portal, kept on the matter record.",
  },
  {
    slug: "emails",
    label: "Emails",
    core: false,
    stage: "soon",
    description: "Email correspondence filed to this matter, threaded and searchable.",
  },
  {
    slug: "calendar",
    label: "Calendar",
    core: false,
    stage: "alpha",
    description:
      "Hearings, depositions, and the dates this matter is held to. Each one is recorded by a " +
      "person, read in its own time zone, and reports when it has passed.",
  },
  {
    slug: "other",
    label: "Other",
    core: false,
    stage: "soon",
    description:
      "Everything else the matter accumulates — research, tasks, and tool output — finds its " +
      "home here.",
  },
];
