/*
 * The matter's section map, and the arrangement the section strip reads it in.
 *
 * TWO LISTS, ONE HOME. `matterSections` is every section that exists — the route segment, the
 * label, the maturity stage (maturity.ts) that decides whether a destination is a live surface or
 * an honest stub, and the paragraph that stub prints. `matterStrip` is the strip's TOP LEVEL: some
 * sections stand on the row by themselves, and the rest sit in a named group that opens a menu.
 *
 * WHY THE STRIP IS GROUPED (owner's ruling, 2026-09-01). Flat, fourteen sections could not fit any
 * canvas: at 1440 the measured fold left seven on the row and put the other seven behind More, and
 * WHICH seven was decided by pixel arithmetic rather than by meaning — Trust and Calendar were
 * buried because of where they happened to sit in a list. Grouping the two neighbourhoods a member
 * already thinks in — the money the matter has moved, the rest of what it has accumulated — takes
 * the row to seven entries, which fits. The measured fold stays behind them as a backstop for a
 * genuinely narrow canvas, not as the arrangement.
 *
 * A GROUP HOLDS AT LEAST TWO SECTIONS. One item behind a menu is the mistake the header's overflow
 * control made — a glyph a member has to open to learn there was nothing in it worth the trip. The
 * builder below refuses it, so the rule cannot be broken by an edit to this file.
 *
 * EVERY SECTION ALSO ANSWERS FOR SEARCH. Each one declares whether the matter's consolidated search
 * can reach it — a source key, or `null` with the one line naming what a source there waits on. It
 * is REQUIRED either way, and `pnpm run lint:matter-search-coverage` fails a section that declares
 * neither. That is what makes the search's growth impossible to forget rather than merely unlikely:
 * adding a fifteenth section forces somebody to answer the question, and the scope dropdown renders
 * the unanswerable ones disabled with their reason instead of quietly omitting them.
 *
 * AND EVERY SECTION ANSWERS FOR THE TIMELINE, the same way. `timelineSources` names the federated
 * timeline sources (packages/calendar/src/sources/all.ts) whose rows this section OWNS — the
 * section an Activity row of that source opens into, behind its own access gate. A source no
 * section owns is declared so in `UNSECTIONED_TIMELINE_SOURCES` with the reason, and
 * `pnpm run lint:matter-timeline-coverage` fails a source that is neither owned nor declared, or
 * owned twice. Ownership lives HERE rather than in the Activity section's own files so that "where
 * does this row open" has one answer, and it is the answer the section registry already gives.
 *
 * EVERY SECTION ALSO ANSWERS FOR CREATE, the same way. The matter header carries ONE create control
 * beside the search, and its label is this registry's answer for the section the reader is on —
 * "New Fee" on Fees, the bare "New" where a section makes several kinds — so the label is settled
 * by the address before the section has even mounted, and the control never changes width or
 * flickers between sections. A section declares the noun it creates, or `CREATE_SEVERAL_KINDS`
 * where its menu names the kinds, or `null` with the line saying why nothing is created there; the
 * behaviour behind the label is claimed by the section's own page through create-action.svelte.ts,
 * and only the page standing on that section may claim it.
 */
import { assertCreateNoun } from "@magna-carta/design-system/create-label";
import type { MaturityStage } from "@magna-carta/design-system/maturity";

/**
 * What a section declares instead of a noun when its create control opens a MENU. The control then
 * reads the bare "New" and the menu items name the kinds — a label naming one of three things
 * would be wrong about the other two, and the noun belongs where the choice is actually made.
 *
 * It is deliberately not a noun and not null: null already means "nothing is created here" and
 * carries `createWaitingOn`, which is a different fact. The space in the value is what keeps it out
 * of the noun grammar (`assertCreateNoun` takes one capitalised word), so the two can never collide.
 */
export const CREATE_SEVERAL_KINDS = "several kinds";

export interface MatterSection {
  /** Route segment under matters/[id]/. */
  slug: string;
  label: string;
  /** Where this section is on the build ladder; drives whether it lands on a surface or a stub. */
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
  /**
   * The timeline source keys whose rows this section owns. Empty where the section holds no record
   * the timeline reads — Overview and Activity consolidate, Fees and Parties have no source yet.
   */
  timelineSources: readonly string[];
  /**
   * What the header's one create control offers on this section: the noun it makes — "Fee" renders
   * as New Fee — or `CREATE_SEVERAL_KINDS` where it opens a menu and reads the bare "New", or null
   * when nothing is created from it. A noun is one capitalised word within the design system's
   * noun budget (create-label.ts in the CreateControl home), so every label fits the control's
   * fixed width; the module refuses anything else at load, and
   * `pnpm run lint:matter-create-control` refuses a section that declares neither a noun nor a
   * reason before anything is built.
   */
  createNoun: string | null;
  /**
   * Required when `createNoun` is null: the one honest line the disabled control carries, naming
   * why nothing is created from this section, in the reader's words.
   */
  createWaitingOn?: string;
}

/**
 * The timeline sources no matter section owns, each with the reason. A row of one of these states
 * what happened and opens nowhere, which is honest; the coverage lint refuses a source that is
 * missing from both this map and every section's `timelineSources`.
 */
export const UNSECTIONED_TIMELINE_SOURCES: Readonly<Record<string, string>> = {
  firmEvent: "Firm-anchored: a firm event belongs to no matter and never appears on one",
};

/** Every section a matter has, in the order the strip reads them. */
export const matterSections: readonly MatterSection[] = [
  {
    slug: "overview",
    timelineSources: ["matterLifecycle", "matterFileDestruction"],
    label: "Overview",
    stage: "alpha",
    description: "The matter at a glance — its facts, status, and what has accrued against it.",
    // Deliberately never a source rather than one that is merely unbuilt: the overview holds no
    // record of its own, it summarises what the other sections hold. A source here would answer
    // the same query twice and put a reader on a summary when they asked for the thing itself.
    searchSource: null,
    searchWaitingOn: "Overview summarises the other sections; searching it would answer twice",
    createNoun: null,
    createWaitingOn:
      "The overview summarises the other sections; each record is created from its own",
  },
  {
    slug: "activity",
    timelineSources: [],
    label: "Activity",
    stage: "alpha",
    description:
      "What has happened on this case, in order, from every part of the platform that records " +
      "anything \u2014 mail saved to the matter, documents, hearings and deadlines, time and costs, " +
      "client money, items in custody, and the notes the firm wrote about all of it.",
    // Never a source, for the Overview's reason: Activity holds no record of its own. Every row is
    // one of the other sections' rows read in date order, so a search source here would answer the
    // same query twice and land a reader on the chronology when they asked for the thing itself.
    searchSource: null,
    // The one record a contribution can make from the chronology today, offered by the register
    // through the header's control (see $lib/activity/activity-register.svelte).
    createNoun: "Note",
    searchWaitingOn: "Activity consolidates the other sections; searching it would answer twice",
  },
  {
    slug: "intake",
    timelineSources: [],
    label: "Intake",
    stage: "alpha",
    description:
      "What this kind of matter must clear before it opens — the firm's own intake procedure, " +
      "each step answered by whoever holds the fact: the conflicts record, the fee arrangement, a " +
      "document produced onto the matter, the trust ledger, or a member recording that they did it.",
    // The checklist is derived at the moment it is read and holds no text of its own beyond the
    // firm's step titles; a search source over it would find the procedure, not the matter.
    searchSource: null,
    searchWaitingOn:
      "Intake is derived from the firm's procedure; there is no matter text to search",
    // A step is created on the firm's procedure under Settings, never from a matter: a step added
    // to one consultation would be a requirement the firm's procedure does not know about.
    createNoun: null,
    createWaitingOn: "Steps come from the firm's intake procedure, written under Settings",
  },
  {
    slug: "conflicts",
    timelineSources: ["conflictsCheck"],
    label: "Conflicts",
    stage: "alpha",
    description:
      "Whether this matter was checked for conflicts, and what the check found \u2014 the search " +
      "that ran, the candidates it surfaced, and who answered each one. A check is run once at the " +
      "start and re-run when the parties or the firm's records move; every one of them stays on " +
      "the record.",
    // The record here is the firm's append-only conflicts log, and it holds no prose about this
    // matter for a search to find: a check row records WHAT WAS SEARCHED, and the names on its
    // hits are the Directory's own, already searchable in their own right. A source here would
    // return the Directory twice over and land a reader on a search instead of on a party.
    searchSource: null,
    searchWaitingOn:
      "A check records what was searched; the names it holds are the Directory's, searched there",
    // Running a check IS the create act on this section, and it writes a new row in an append-only
    // log rather than editing the last one.
    createNoun: "Check",
  },
  {
    slug: "files",
    timelineSources: ["documentFiled", "documentAssembly", "fileHistory"],
    label: "Files",
    stage: "alpha",
    description:
      "The matter's versioned file record — every document the firm holds for this matter, " +
      "organized in folders, each version kept and each byte's integrity hash recorded.",
    searchSource: "files",
    // A document, a folder and an upload are three kinds, so the control reads "New" and the menu
    // names them. It read "New File" over that menu, which was wrong about two of the three.
    createNoun: CREATE_SEVERAL_KINDS,
  },
  {
    slug: "time",
    timelineSources: ["timeEntry"],
    label: "Time",
    stage: "alpha",
    description:
      "Time captured on this matter — timers, manual entries, and the weekly grid all land " +
      "here, billable or not.",
    searchSource: "time",
    createNoun: "Time",
  },
  {
    slug: "fees",
    timelineSources: [],
    label: "Fees",
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
    createNoun: "Fee",
  },
  {
    slug: "costs",
    timelineSources: ["costEntry"],
    label: "Costs",
    stage: "alpha",
    description:
      "Costs advanced and expenses incurred for this matter — filing fees, service, experts — " +
      "with their recoverable and billable treatment.",
    searchSource: "costs",
    createNoun: "Cost",
  },
  {
    slug: "billing",
    timelineSources: [],
    label: "Billing",
    stage: "alpha",
    description:
      "Invoices, payments, and the matter's billing arrangement — hourly, flat fee, or " +
      "contingency — with the full accounting of what has been billed and collected.",
    searchSource: "billing",
    createNoun: "Bill",
  },
  {
    slug: "trust",
    timelineSources: ["trustMovement"],
    label: "Trust",
    stage: "alpha",
    description:
      "The matter's trust ledger — client funds held, disbursed, and reconciled under the " +
      "governing jurisdiction's rules. Fees never touch trust until earned.",
    searchSource: null,
    searchWaitingOn: "A matter-wide trust source is not wired yet",
    createNoun: "Deposit",
  },
  {
    slug: "notes",
    timelineSources: ["matterNote"],
    label: "Notes",
    stage: "alpha",
    description: "Matter notes and memoranda — dated, attributed, and searchable.",
    searchSource: "notes",
    createNoun: "Note",
  },
  {
    slug: "tasks",
    timelineSources: ["matterTask"],
    label: "Tasks",
    stage: "alpha",
    description:
      "What the firm still owes on this matter — each piece of work with somebody's name on it, " +
      "when it is due, and whether it is done.",
    createNoun: "Task",
    searchSource: null,
    // A task has searchable text — the title and the body — and the section's own list already
    // narrows on it. What is missing is a source in packages/matter-search/src/sources/all.ts, and
    // wiring one is a real piece of work rather than a line here: the task read composes the
    // visibility fragment that decides whether a matterless task is reachable, and a source that
    // reproduced that condition instead of composing it would be a second answer to who may see
    // what. The section's own search box finds them in the meantime.
    searchWaitingOn:
      "Search within the Tasks section itself; a matter-wide task source is not wired yet",
  },
  {
    slug: "emails",
    timelineSources: ["emailFiled"],
    label: "Emails",
    stage: "soon",
    description: "Email correspondence filed to this matter, threaded and searchable.",
    searchSource: null,
    searchWaitingOn: "The Emails section itself is not built yet",
    createNoun: null,
    createWaitingOn: "The Emails section itself is not built yet",
  },
  {
    slug: "messaging",
    timelineSources: ["communication"],
    label: "Messaging",
    stage: "alpha",
    description:
      "Calls and texts on this matter \u2014 every voice call and message thread with the people on " +
      "the case, logged as it happens, and for a call the recording and its transcript where the " +
      "jurisdiction allows one.",
    searchSource: "communications",
    // A call is what the member wrote down about it; a text is its own words. Both are matched, and
    // so is the number, which is how people actually look for a conversation.
    createNoun: "Message",
  },
  {
    slug: "custodian",
    timelineSources: ["custodyMovement", "custodyReviewDue", "custodyDueBack"],
    label: "Custodian",
    stage: "alpha",
    description:
      "Physical items in the firm's custody for this matter — original wills, deeds, media — " +
      "tracked to a location, safe, and box.",
    searchSource: "custody",
    createNoun: "Packet",
  },
  {
    slug: "discovery",
    timelineSources: [],
    label: "Discovery",
    stage: "alpha",
    description:
      "The corpora this matter is reviewing \u2014 the firm's own collection, a production another " +
      "party served, each with its own documents, its own record of what arrived, and its own list " +
      "of who may open it.",
    /*
     * NEVER A SEARCH SOURCE, and this is a permanent answer rather than an unbuilt one.
     *
     * A review set is its own corpus by construction: the search index's split catalog is keyed by
     * corpus rather than by matter, so a matter search is STRUCTURALLY unable to name a review
     * set's splits. That is not a performance decision. Material an opposing party produced is
     * under a protective order, it is not the firm's work product, and a control that could return
     * both in one list is the failure the key shape exists to prevent. The review set's own search,
     * behind its own access list, is where that corpus is asked anything.
     *
     * So the disabled scope option must NOT read like the ones waiting on wiring. There is nothing
     * to wire.
     */
    searchSource: null,
    searchWaitingOn:
      "A review set is a separate corpus behind its own access list; the matter's search never " +
      "reaches it",
    /*
     * Two kinds, so the control reads the bare "New" and the menu names them: a review set, and a
     * load into one that exists. It is also the one section where a noun would not have fit — the
     * domain's own term is two words, and the label grammar carries one.
     */
    createNoun: CREATE_SEVERAL_KINDS,
  },
  {
    slug: "parties",
    timelineSources: [],
    label: "Parties",
    stage: "alpha",
    description:
      "Every person and organization connected to this matter — clients, opposing parties, " +
      "counsel, courts — linked from the firm Directory with conflict-aware roles.",
    searchSource: "parties",
    createNoun: "Party",
  },
  {
    slug: "calendar",
    timelineSources: ["matterEvent", "matterDeadline"],
    label: "Calendar",
    stage: "alpha",
    description:
      "Hearings, depositions, and the dates this matter is held to. Each one is recorded by a " +
      "person, read in its own time zone, and reports when it has passed.",
    searchSource: "calendar",
    // An event and a deadline are two kinds, so the control reads "New" and the menu names them.
    createNoun: CREATE_SEVERAL_KINDS,
  },
  {
    slug: "magnus",
    timelineSources: [],
    label: "Magnus",
    stage: "alpha",
    description:
      "Ask Magnus about this matter. The assistant answers from what you type in the " +
      "conversation, and every exchange is kept on the matter record.",
    searchSource: null,
    // A transcript is discoverable material, so any surface that searches across the firm's records
    // has to let the firm say whether transcripts are in scope — an explicit include or exclude,
    // never a default either way. That control does not exist yet, and it belongs to the search
    // surface rather than to this section, so nothing here is reachable from the matter's search
    // until it does. The section itself is built; this is the only thing still missing.
    searchWaitingOn:
      "A search that reaches transcripts needs a control saying whether they are in scope",
    createNoun: null,
    createWaitingOn: "Magnus is a way to ask about the matter, not a record it keeps",
  },
];

/** One entry of the strip's top level: a section on the row, or a named group that opens a menu. */
export type MatterStripEntry =
  | { readonly kind: "section"; readonly section: MatterSection }
  | { readonly kind: "group"; readonly label: string; readonly sections: readonly MatterSection[] };

/*
 * The arrangement, declared by slug so the two lists cannot drift: a section nobody placed, a slug
 * that names no section, and a section placed twice are all module-load failures rather than a tab
 * that silently stops existing.
 *
 * Overview leads because it is where the bare matter address lands. Intake follows it because it
 * is the front of the file: what a consultation must clear before it is a matter at all, read
 * before anything else on a new file and rarely after. It stands on the row rather than in a group
 * because it belongs to neither neighbourhood — it is not money the matter moved and not a record
 * the matter accumulated — and a group of one is forbidden below. Conflicts follows Intake, and
 * stands on the row BESIDE it rather than folded into it (the owner's ruling, 2026-09-07): the two
 * are separate destinations in the global sidebar for the reason they are separate here — running
 * a check is not one of the intake procedure's steps, it is the act a step ASKS ABOUT, and the
 * record it writes outlives the intake that prompted it. It sits this high for the same reason
 * Intake does, and for one more: a check is run once at the front of a file, and after that the
 * question is only ever "was it done, and what did it say", which is a lookup a reader should not
 * have to open a menu for. Activity leads the Record group
 * because it is the record read in order: the chronology of everything the group's other sections
 * hold, one click from Overview's own recent-activity tile. Files stands alone because it
 * is the section members are in most — putting the busiest destination behind a menu would spend a
 * click on nearly every visit. Parties and Calendar stand alone on the owner's ruling: a matter's
 * dates are checked too often to sit behind a menu, and with Calendar on the row the group they
 * shared would have held Parties by itself, which the rule below forbids. Tasks sits beside
 * Calendar for the same reason and emphatically not in Record: Record is what the matter has
 * accumulated, and what the firm still owes is not one of those. Magnus stands alone because it is
 * not one of the matter's records; it is the way to ask about them. Discovery closes the Record
 * group beside Custodian, which is the pairing the sidebar already makes: both are material the
 * firm holds and must account for, one electronic and one physical. It goes in a group rather than
 * on the row because the row is full at seven and a review set is opened at the start of a review
 * and then worked from its own screen, not checked on every visit the way the dates are.
 *
 * The order is also the fold order — the backstop folds from the tail — so what folds first is what
 * a member can most afford to reach through a menu: Magnus (asked once in a while, not read on
 * every visit), then the Record group (three of its four are stubs), then the work owed, the dates
 * and the people. Money stays on the row longest of the
 * folding candidates, because all five of its sections are live working surfaces. Conflicts is the
 * tenth top-level entry and so spends some of that backstop's headroom; it is placed knowing that,
 * because what folds under the pressure it adds is the tail — the section asked once in a while,
 * then the group of stubs — and never Conflicts itself.
 */
const ARRANGEMENT: readonly (
  | string
  | { readonly label: string; readonly slugs: readonly string[] }
)[] = [
  "overview",
  "intake",
  "conflicts",
  "files",
  { label: "Money", slugs: ["time", "fees", "costs", "billing", "trust"] },
  "parties",
  "calendar",
  "tasks",
  {
    label: "Record",
    slugs: ["activity", "notes", "emails", "messaging", "custodian", "discovery"],
  },
  "magnus",
];

function buildStrip(): readonly MatterStripEntry[] {
  const bySlug = new Map(matterSections.map((section) => [section.slug, section]));
  const placed = new Set<string>();

  const take = (slug: string): MatterSection => {
    const section = bySlug.get(slug);
    if (section === undefined) {
      throw new Error(`The matter strip places "${slug}", which is not a section.`);
    }
    if (placed.has(slug)) {
      throw new Error(`The matter strip places "${slug}" more than once.`);
    }
    placed.add(slug);
    return section;
  };

  const entries = ARRANGEMENT.map((entry): MatterStripEntry => {
    if (typeof entry === "string") return { kind: "section", section: take(entry) };
    if (entry.slugs.length < 2) {
      throw new Error(
        `The matter strip's "${entry.label}" group holds ${entry.slugs.length} section(s). A group ` +
          "of one is a menu that has to be opened to learn it holds nothing worth the trip; put " +
          "the section on the row instead.",
      );
    }
    return { kind: "group", label: entry.label, sections: entry.slugs.map(take) };
  });

  const unplaced = matterSections.filter((section) => !placed.has(section.slug));
  if (unplaced.length > 0) {
    throw new Error(
      `The matter strip places no entry for: ${unplaced.map((section) => section.slug).join(", ")}. ` +
        "Every section is reachable from the strip or it does not exist.",
    );
  }
  return entries;
}

/** The strip's top level, in order. Validated at module load against the section registry. */
export const matterStrip: readonly MatterStripEntry[] = buildStrip();

/** The section that owns a timeline source's rows, or undefined where none does. */
export function sectionOwningTimelineSource(sourceKey: string): MatterSection | undefined {
  return matterSections.find((section) => section.timelineSources.includes(sourceKey));
}

/*
 * Every create answer is checked the moment the registry loads: a noun the design system's label
 * grammar refuses, or a declined section with no line to show, is a module-load failure rather
 * than a control that clips or a disabled button that says nothing. The lint gate runs the same
 * rules over the source before anything is built.
 */
for (const section of matterSections) {
  if (section.createNoun === CREATE_SEVERAL_KINDS) continue;
  if (section.createNoun === null) {
    if (section.createWaitingOn === undefined || section.createWaitingOn.trim() === "") {
      throw new Error(
        `The "${section.slug}" section creates nothing and says nothing about why. Declare ` +
          "`createWaitingOn`: the disabled control carries that line.",
      );
    }
    continue;
  }
  assertCreateNoun(section.createNoun);
}

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
