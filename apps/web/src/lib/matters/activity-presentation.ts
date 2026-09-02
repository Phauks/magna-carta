/*
 * How the matter's activity reads — the one place a federated timeline source becomes words.
 *
 * THE PLATFORM'S TIMELINE IS A REGISTRY, AND SO IS THIS. `packages/calendar/src/sources/all.ts`
 * declares each source once: where its rows live, how to read a page, and whether it has a
 * non-privileged label. Nothing in that declaration is presentation — it deliberately says nothing
 * about icons, sentences or grouping, because a read-side declaration that also decided how a screen
 * looked would make every new source a UI change too. So this file is the other half: one entry per
 * source key, and adding a source to the platform is adding one entry here.
 *
 * That pairing is enforced rather than remembered. `activity-presentation.test.ts` scans the
 * calendar package's own source declarations and fails when a key it declares has no entry below, so
 * a new subsystem joining the timeline cannot reach a person's screen as an unexplained row.
 *
 * MOST ENTRIES CARRY NO WORDS OF THEIR OWN, AND THAT IS THE DESIGN. A note, a captured email and a
 * matter's own lifecycle all declare no label, because a note's first eight words and a subject line
 * are exactly the disclosure a read spanning every matter must not make. So an entry says WHAT
 * happened, WHEN, and BY WHOM — and the words are one authenticated request away behind the link.
 * `happened` is therefore the primary text of most rows rather than a fallback, and it is written to
 * stand on its own: "A note was written", never "Note".
 *
 * WHERE A SOURCE DOES DECLARE A LABEL, WHAT THE LABEL MEANS IS NOT OBVIOUS. `documentFiled` labels
 * with the document's TYPE and `timeEntry` with a duration — neither is a title, and a reader shown
 * a bare "Retainer Agreement" beside a document row would reasonably think it was the file's name.
 * `labelMeaning` names the field so the row can say which fact it is showing.
 *
 * NOTHING HERE SAYS A DOCUMENT WAS "FILED". To a lawyer, filing means filing WITH A COURT, and this
 * platform files nothing with a court: adding a document to the matter's own record is adding it,
 * and an email arriving on a matter is saved to it. The source KEYS are `documentFiled` and
 * `emailFiled` and stay that way — they are wire contracts, permanent once shipped — which is
 * exactly why the words a person reads are decided here and not taken from them. The standing rule
 * is in docs/conventions/design-corrections.md.
 */
import Banknote from "@lucide/svelte/icons/banknote";
import CalendarClock from "@lucide/svelte/icons/calendar-clock";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import CircleDot from "@lucide/svelte/icons/circle-dot";
import Clock from "@lucide/svelte/icons/clock";
import FileStack from "@lucide/svelte/icons/file-stack";
import FileText from "@lucide/svelte/icons/file-text";
import Flag from "@lucide/svelte/icons/flag";
import Mail from "@lucide/svelte/icons/mail";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Package from "@lucide/svelte/icons/package";
import PackageCheck from "@lucide/svelte/icons/package-check";
import Receipt from "@lucide/svelte/icons/receipt";
import ScanSearch from "@lucide/svelte/icons/scan-search";
import Wallet from "@lucide/svelte/icons/wallet";
import { hasSurface } from "$lib/maturity/maturity.ts";
import { matterSections } from "./sections.ts";

/** A Lucide icon, as the repository types one in a registry (see the alert variants). */
type IconComponent = typeof FileText;

export interface ActivitySourcePresentation {
  /** The wire source key, exactly as `packages/calendar` declares it. Permanent once shipped. */
  readonly key: string;
  /**
   * What this kind of thing is called, singular. It is the Kind column's value, which makes it the
   * vocabulary of that column's set filter — so it is the word a person narrows the register by, and
   * two sources that would read as the same kind to a reader may deliberately share one.
   */
  readonly noun: string;
  /**
   * What happened, as a whole sentence in the platform's own voice. It is the row's primary text on
   * every source that declares no label, so it never leans on a heading or an icon to make sense.
   */
  readonly happened: string;
  readonly icon: IconComponent;
  /**
   * What the source's declared label actually IS, where it declares one — "Document type", "Time
   * booked". Absent on a source that declares no label. Naming it is what stops a reader taking a
   * document's type for its name.
   */
  readonly labelMeaning?: string;
  /**
   * The matter section an entry of this source opens into, when the platform builds its deep link.
   * Absent where the owning surface is not a matter section at all — the entry then states what
   * happened and offers nowhere to go, which is honest, rather than linking into a 404.
   */
  readonly section?: string;
}

/*
 * One entry per source key in `packages/calendar/src/sources/all.ts`.
 */
const PRESENTATIONS: readonly ActivitySourcePresentation[] = [
  {
    key: "matterNote",
    noun: "Note",
    happened: "A note was written",
    icon: NotebookPen,
    section: "notes",
  },
  {
    key: "emailFiled",
    noun: "Email",
    happened: "An email was saved to the matter",
    icon: Mail,
    section: "emails",
  },
  {
    key: "documentFiled",
    noun: "Document",
    happened: "A document was added to the matter",
    icon: FileText,
    labelMeaning: "Document type",
    section: "files",
  },
  {
    key: "documentAssembly",
    noun: "Assembled document",
    happened: "A document was assembled from a template",
    icon: FileStack,
    labelMeaning: "Outcome and the count of fields the matter had no value for",
    section: "files",
  },
  {
    key: "matterEvent",
    noun: "Event",
    happened: "An event was recorded",
    icon: CalendarDays,
    labelMeaning: "Event type",
    section: "calendar",
  },
  {
    key: "matterDeadline",
    noun: "Deadline",
    happened: "A deadline was recorded",
    icon: CalendarClock,
    labelMeaning: "Deadline",
    section: "calendar",
  },
  {
    key: "timeEntry",
    noun: "Time entry",
    happened: "Time was booked",
    icon: Clock,
    labelMeaning: "Time booked",
    section: "time",
  },
  {
    key: "costEntry",
    noun: "Cost",
    happened: "A cost was recorded",
    icon: Receipt,
    labelMeaning: "Cost",
    section: "costs",
  },
  {
    key: "trustMovement",
    noun: "Trust movement",
    happened: "Client money moved",
    icon: Banknote,
    labelMeaning: "Movement",
    section: "trust",
  },
  {
    key: "custodyMovement",
    noun: "Custody movement",
    happened: "An item in the firm's custody moved",
    icon: Package,
    labelMeaning: "Movement",
    section: "custodian",
  },
  {
    key: "custodyReviewDue",
    noun: "Custody review",
    happened: "An item in custody is due for review",
    icon: ScanSearch,
    labelMeaning: "Review",
    section: "custodian",
  },
  {
    key: "custodyDueBack",
    noun: "Custody return",
    happened: "An item checked out is due back",
    icon: PackageCheck,
    labelMeaning: "Return",
    section: "custodian",
  },
  {
    key: "matterLifecycle",
    noun: "Matter",
    happened: "The matter changed standing",
    icon: Flag,
    section: "overview",
  },
  {
    key: "conflictsCheck",
    noun: "Conflicts check",
    happened: "A conflicts check was run",
    icon: CircleDot,
    labelMeaning: "Outcome",
    // No matter section owns a conflicts check, so an entry says what happened and offers nowhere
    // to go rather than sending somebody to a screen that does not exist.
  },
  {
    key: "firmEvent",
    noun: "Firm event",
    happened: "A firm-wide event was recorded",
    icon: Wallet,
    labelMeaning: "Event type",
    // Firm-anchored: it belongs to no matter, so it never appears on a matter's activity. The entry
    // exists so the registry pairing stays complete and a firm-wide activity read inherits it.
  },
];

const BY_KEY: ReadonlyMap<string, ActivitySourcePresentation> = new Map(
  PRESENTATIONS.map((presentation) => [presentation.key, presentation]),
);

/** Every declared presentation, in registry order. */
export const ACTIVITY_PRESENTATIONS = PRESENTATIONS;

/**
 * How one source reads, or undefined where this build carries no entry for it.
 *
 * Undefined is answered rather than guessed at: a row from a source this screen does not know is
 * shown as the plain fact that something was recorded, which is true, instead of a made-up sentence
 * that might not be. A deployed client meeting a server one release ahead is exactly that case.
 */
export function presentationFor(sourceKey: string): ActivitySourcePresentation | undefined {
  return BY_KEY.get(sourceKey);
}

/** What an entry from this source says happened. Honest where the source is unknown to this build. */
export function happenedText(sourceKey: string): string {
  return presentationFor(sourceKey)?.happened ?? "Something was recorded on the matter";
}

/**
 * Where following this entry goes, or null where there is nowhere to go.
 *
 * The platform builds the deep link, and this only decides whether to OFFER it: a link into a
 * section that is not built yet lands on a stub that cannot honour the `entry` it was handed, which
 * reads as a broken product rather than an unfinished one. Sections come alive on their own
 * schedule, so the question is asked of the section registry rather than answered by a list here
 * that would need maintaining a second time.
 */
export function followableLink(sourceKey: string, link: string): string | null {
  const section = presentationFor(sourceKey)?.section;
  if (section === undefined) return null;
  const registered = matterSections.find((candidate) => candidate.slug === section);
  if (registered === undefined || !hasSurface(registered.stage)) return null;
  return link;
}
