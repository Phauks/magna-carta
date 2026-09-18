/*
 * The global-sidebar destination registry — data, not markup. The canonical order and grouping
 * are the owner-approved decisions in docs/specs/2026-06-12-page-archetypes.md: identical for
 * everyone; permission/module differences HIDE items in place, nothing ever reorders.
 *
 * `shipped` is the light-up switch: a destination ships when its USER-FACING surface ships (the
 * sidebar is a promise to the user, not an inventory of the codebase), flipped in the same
 * commit as the surface. `permission` and firm module flags attach to these entries when the
 * auth session lands — filtering composes onto the registry; the registry itself never changes
 * shape for it.
 *
 * THE VISIBILITY LAYER: this registry stays canonical — membership, groups, clusters, canonical
 * order, the shipped/announced light-ups. WHICH rows the sidebar shows, and in what per-group
 * order, is the member's own preference (src/lib/navigation/sidebar-preferences.svelte.ts):
 * pinned + shown rows render; everything else is brought back from the sidebar's own Customize
 * mode, which reveals every destination grouped. `defaultShown` is the registry's half of that
 * contract — the curated core arrives visible, exotic additions arrive available-but-quiet.
 *
 * SHOWING A ROW IS NOT FAVOURITING IT, and the two now wear different marks (owner ruling,
 * 2026-09-16). Customize decides whether a destination the platform ships appears in its group,
 * and says so with an EYE — the plain word for "visible here". A FAVOURITE is the member's own
 * shortcut to any address at all, a matter or a tool or a screen deep inside one, and keeps the
 * STAR, which is what a star means everywhere else. Favourites are not registry data and are not
 * declared in this file: they live in navigation/favorites.svelte.ts and render as the rail's
 * first group.
 *
 * ONLY REAL THINGS (owner-directed): every entry is either `shipped` (its user-facing surface
 * exists) or `announced` (an owner-curated Soon stub the sidebar and palette pre-announce ahead
 * of the build). Nothing speculative lives here — the sidebar is a promise to the user, not an
 * inventory of the backlog.
 *
 * The Ctrl+K command palette (src/lib/components/command-palette.svelte) also renders from this
 * registry — adding a destination here is what makes it searchable; never hand-list it there.
 * Hiding a row never touches the palette: hiding must never remove capability.
 */
import type { Component } from "svelte";
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import House from "@lucide/svelte/icons/house";
import Download from "@lucide/svelte/icons/download";
import Upload from "@lucide/svelte/icons/upload";
import Bell from "@lucide/svelte/icons/bell";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import Users from "@lucide/svelte/icons/users";
import FileText from "@lucide/svelte/icons/file-text";
import ClipboardPenLine from "@lucide/svelte/icons/clipboard-pen-line";
import Inbox from "@lucide/svelte/icons/inbox";
import Clock from "@lucide/svelte/icons/clock";
import Coins from "@lucide/svelte/icons/coins";
import Landmark from "@lucide/svelte/icons/landmark";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import FileSearch from "@lucide/svelte/icons/file-search";
import Settings from "@lucide/svelte/icons/settings";
import Vault from "@lucide/svelte/icons/vault";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import MessageSquare from "@lucide/svelte/icons/message-square";
import Video from "@lucide/svelte/icons/video";
import ChartColumn from "@lucide/svelte/icons/chart-column";
import ChartPie from "@lucide/svelte/icons/chart-pie";
import Sparkles from "@lucide/svelte/icons/sparkles";
import ListChecks from "@lucide/svelte/icons/list-checks";
import HandCoins from "@lucide/svelte/icons/hand-coins";

export type DestinationGroup =
  | "favorites"
  | "desk"
  | "work"
  | "communications"
  | "money"
  | "firm"
  | "tools";

export interface Destination {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  readonly href: string;
  readonly icon: Component;
  /** One line describing what living here gets you (the palette and Customize mode show it). */
  readonly description: string;
  readonly group: DestinationGroup;
  /** Renders in the sidebar only when true — flipped when the surface's UI ships. */
  readonly shipped: boolean;
  /**
   * An unshipped destination the sidebar (and palette) already ANNOUNCE as a Soon row — the
   * owner is feeling out the ordering ahead of the builds. Flipping `shipped` retires the Soon
   * treatment; `announced` without `shipped` is the only combination that renders disabled.
   */
  readonly announced?: true;
  /**
   * Cannot be hidden — Customize mode shows a lock instead of the eye ("always in your sidebar").
   * Home and the footer fixtures also hold fixed positions (Home first; Downloads, Uploads and
   * Settings in the pinned footer); Matters is movable within its group but never hideable.
   */
  readonly pinned?: true;
  /**
   * The registry's half of the visibility contract: whether this destination arrives in a fresh
   * member's sidebar. The curated core is true; future exotic additions arrive false —
   * revealed in Customize mode and brought in by a click, never pushed.
   */
  readonly defaultShown: boolean;
  /**
   * The sub-menu this row folds into within its group (navigation/clusters.ts), when it folds into
   * one at all. A cluster is a FOLD, never a screen: it has no address and opening it reveals its
   * rows. A cluster holding a single row is seated as a plain row instead, so a chevron never hides
   * one thing.
   */
  readonly cluster?: string;
  /**
   * The permission that gates this destination, for the few surfaces that are not simply "a place
   * in the app everyone with a seat can stand". A destination without one is visible to every
   * member; one with it renders only for a member who holds the key, in the rail and in the palette
   * alike (filtering composes onto the registry — the registry never changes shape for it).
   */
  readonly permission?: Permission;
  /**
   * Lives in the sidebar's pinned footer utility tray, not the scrolling groups — Settings,
   * Downloads and Uploads. The groups renderer (and Customize mode with it) skips it; the
   * footer renders it from this entry so the row has one home. What earns a place here is
   * meta about the app rather than a place in the firm's work: settings, and the two transfer
   * registers that run alongside whatever you are doing (owner-directed, 2026-09-07). The
   * top-bar trays stay what they are — summaries with quick actions; these are the full
   * surfaces they open into.
   */
  readonly footerPinned?: true;
  /**
   * Lights as current only on its OWN address, never on what sits beneath it. The default is the
   * opposite — a destination owns everything under its path, which is what puts the gilt bar on
   * Matters while a matter is open. An index whose children are destinations in their own right
   * needs this, or two rows read as current at once.
   */
  readonly exact?: true;
  /**
   * Where this destination's surface is on the build ladder (maturity.ts), shown as a badge on
   * its sidebar row (or a dot on an icon-only control). Optional: when omitted it derives from
   * `shipped` — an unshipped destination reads "soon", a shipped one reads "ready" (no mark).
   * Set it explicitly to mark a shipped-but-still-maturing surface (e.g. "alpha").
   */
  readonly stage?: MaturityStage;
}

/** The destination's effective maturity stage — explicit when set, else derived from `shipped`. */
export function destinationStage(destination: Destination): MaturityStage {
  return destination.stage ?? (destination.shipped ? "ready" : "soon");
}

/*
 * Group headings in canonical order — the rail's first level, reworked on the owner's direction of
 * 2026-09-16. Every group carries a heading (a headless top group read as unbalanced against the
 * labelled ones), and each answers ONE question:
 *
 *   Favourites — the member's own shortcuts. Not registry data: the rows come from
 *                navigation/favorites.svelte.ts, and the group is absent until a member makes one.
 *                It leads the rail because a shortcut nobody passes on the way to something else is
 *                a shortcut nobody uses.
 *   My Desk    — what is on MY plate: my day, my alerts, my tasks, my calendar, my assistant.
 *                Home and Notifications sat in Workspace until now, which put "your morning" in the
 *                same list as "the firm's evidence"; they are about the person, not about the work,
 *                and a fourteen-row Workspace group was the price of not saying so.
 *   Workspace  — the firm's work: matters and everything that hangs off one.
 *   Money      — the ledger, in the order money moves.
 *   Firm       — the firm about itself: its numbers, its consumption, its settings.
 *   Tools      — the standalone utilities, folded into subject clusters.
 *
 * TOOLS IS THE ONE GROUP THIS FILE DOES NOT HOLD THE ROWS FOR. The tool catalog
 * (@magna-carta/tools) is already the one home of what a tool is, and its rows reach the rail
 * through navigation/tool-sidebar.ts. Copying nine tools in here would be the same fact in two
 * registries, free to disagree the first time one is added. Favourites likewise: they are the
 * member's, not the platform's.
 */
export const DESTINATION_GROUPS: ReadonlyArray<{ id: DestinationGroup; label: string }> = [
  { id: "favorites", label: "Favorites" },
  { id: "desk", label: "My Desk" },
  { id: "work", label: "Workspace" },
  // Every channel the firm talks through, in one place (owner ruling, 2026-09-18): calls and texts
  // today, meetings beside them, and whatever else carries a conversation — a row for each is a
  // row a member scans past in the workspace, where the question is "what is the firm working on"
  // rather than "how do I reach somebody".
  { id: "communications", label: "Communications" },
  { id: "money", label: "Money" },
  { id: "firm", label: "Firm" },
  { id: "tools", label: "Tools" },
];
/*
 * ORDERING IS UNDER REVIEW (owner-directed draft, 2026-07-03): the announced Soon rows exist
 * precisely so the owner can feel the order — daily drivers and matter-work first, money next,
 * output last. It is data; reorder THIS array (and nothing else) to try another arrangement.
 * Members now reorder their OWN sidebars (the star layer), but this canonical order still
 * matters: it is every fresh sidebar, the order Customize mode reveals hidden destinations in,
 * and where reconciliation seats new arrivals.
 */
const DESTINATION_LIST = [
  // My Desk — the member's own surfaces: the day, the alerts, the plate, the diary, the assistant.
  // The two transfer registers are `desk` too (they are this member's transfers), though the rail
  // seats them in the footer tray rather than the group.
  {
    id: "home",
    label: "Home",
    href: "/home",
    icon: House,
    description: "Your day at a glance — tasks, deadlines, and the matters you touch.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultShown: true,
  },
  {
    // The download register: what the platform produced for this member, kept for a short window so
    // it can be taken again. Deliberately NOT the notification feed — that surface carries the
    // firm's work, and a generated file is platform mechanics (owner ruling, 2026-08-31).
    //
    // A FOOTER FIXTURE, not a workspace row (owner-directed, 2026-09-07): downloads and uploads run
    // concurrently with the work rather than being part of it, so they sit with Settings and
    // Customize at the rail's foot. The group is still `top` because the palette lists the whole
    // registry flat and this is a workspace-register surface; only the sidebar placement moved.
    id: "downloads",
    label: "Downloads",
    href: "/downloads",
    icon: Download,
    description: "Reports and files the platform made for you, ready to download again.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultShown: true,
    footerPinned: true,
  },
  {
    // The uploads this browser tab is running: every batch in full, with each file's standing, the
    // rate and the time left. Live state rather than a register — an upload dies with the tab — so
    // it is the download shelf's opposite number, not a second shelf. It shares the download
    // register's footer home for the same reason.
    id: "uploads",
    label: "Uploads",
    href: "/uploads",
    icon: Upload,
    description: "Files you are sending to matters, each one's progress, and what did not go.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultShown: true,
    footerPinned: true,
  },
  {
    // A shipped stub: the page exists (an honest empty state) so the top-bar bell has a home to
    // open into. The alerts machinery that fills it arrives later.
    id: "notifications",
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    description: "Alerts, mentions, and updates across your matters.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    // The member's own work, across every matter they can see plus their own tasks on no matter.
    // It sits in the workspace group beside Notifications rather than under a matter, because "what
    // is on my plate" is a question about the person and not about any one case — and a task list
    // somebody has to go looking for inside each matter is a task list nobody looks at.
    //
    // Named for the record it holds, not for whose it is: a matter's own section is Tasks, so a
    // second name for the same noun made the sidebar and the matter disagree about one word.
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: ListChecks,
    description: "Every task with your name on it, across your matters and the firm's own work.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    // Magnus — the Magna Carta assistant. This is its always-reachable home: one sidebar entry,
    // easy to find at all times (owner-directed). The member's own workspace for it — every
    // conversation they have had, and the composer to start another. A matter's Magnus section is
    // the same surface filtered to that matter's file; this one belongs to the member.
    //
    // It answers and nothing else: it cannot create, edit, file, send or delete, and it reads only
    // what a member types into the conversation they are in.
    id: "magnus",
    label: "Magnus",
    href: "/magnus",
    icon: Sparkles,
    description: "The Magna Carta assistant — ask, draft, and navigate in plain language.",
    group: "desk",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description: "Deadlines, hearings, and appointments across the firm.",
    group: "desk",
    shipped: true,
    // The firm calendar reads and records; the room grid, kind narrowing and the member picker
    // beyond Mine/Everyone are still to come.
    stage: "alpha",
    defaultShown: true,
  },
  // Workspace — the firm's work. Matters leads it; everything else here hangs off a matter or
  // feeds one.
  {
    id: "matters",
    label: "Matters",
    href: "/matters",
    icon: FolderOpen,
    description: "Every matter the firm holds — the work's home.",
    group: "work",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultShown: true,
  },
  {
    id: "intake",
    label: "Intake",
    href: "/intake",
    icon: Inbox,
    description: "New client and matter intake, from first inquiry to open file.",
    group: "work",
    shipped: true,
    // The desk lists every intake in flight, starts one, and schedules the consultation; the public
    // form, the pipeline board and call intake are still to come.
    stage: "alpha",
    defaultShown: true,
  },
  {
    // Runs at intake, so it sits beside it.
    id: "conflicts",
    label: "Conflicts Check",
    href: "/conflicts",
    icon: ShieldAlert,
    description: "Conflict checks run at intake and on demand.",
    group: "work",
    shipped: true,
    // The runner, the firm's check history, one check read back with its candidates and their
    // adjudications, where a matter stands, and the firm's own floor under Settings. What is still
    // short of the whole act is the assembled report a firm could hand a court: printing gives a
    // sheet rather than a document filed onto the matter.
    stage: "alpha",
    defaultShown: true,
  },
  {
    id: "directory",
    label: "Directory",
    href: "/directory",
    icon: Users,
    description: "Clients, parties, counsel, and courts in one book.",
    group: "work",
    shipped: true,
    // Alpha, not ready: the record is searched rather than browsed, and three of its panes render
    // their shape while their reads are built.
    stage: "alpha",
    defaultShown: true,
  },
  {
    // Calls and texts — the two channels a conversation only exists in if the platform records it.
    // Email is deliberately NOT here: mail already lives in the firm's own mailbox and is FILED onto
    // a matter from there, so a second reader for it would compete with the client a member already
    // has open. The id stays "communications" because a member's sidebar stars are stored under it —
    // the PATH is /messaging, which is what the row has always been called (owner ruling,
    // 2026-09-08): a URL naming the subsystem rather than the screen is one nobody can guess.
    id: "communications",
    label: "Messaging",
    href: "/messaging",
    icon: MessageSquare,
    description: "Calls and texts with clients, logged against their matters.",
    group: "communications",
    shipped: true,
    // The log reads and records what a member writes down. Nothing is sent or received yet: the
    // carrier adapter that writes these same rows by itself, and the recording and transcript that
    // hang off a call, are the rungs after this one.
    stage: "alpha",
    defaultShown: true,
  },
  {
    // Video meetings, started from a calendar event and listed here so a member can see what is
    // live and get back into a room without finding the event first. Gated by the join key rather
    // than shown to every seat: a member who cannot join a meeting has nothing to open here.
    id: "meetings",
    label: "Meetings",
    href: "/meetings",
    icon: Video,
    description: "Video meetings on the firm's calendar — live now, ahead, and recently ended.",
    group: "communications",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
    permission: "meetings:join",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileText,
    description: "The firm's documents — stored, scanned, and versioned.",
    group: "work",
    shipped: false,
    announced: true,
    defaultShown: true,
  },
  {
    // Document automation and court forms — the documents cluster, distinct glyph from
    // Documents itself.
    id: "forms",
    label: "Forms",
    href: "/forms",
    icon: ClipboardPenLine,
    description: "Document automation and court forms.",
    group: "work",
    shipped: false,
    announced: true,
    defaultShown: true,
  },
  {
    // The evidence cluster: discovery beside its custodian stewardship.
    id: "discovery",
    label: "Discovery",
    href: "/discovery",
    icon: FileSearch,
    description: "Every review set you can reach, across every matter.",
    group: "work",
    shipped: true,
    /*
     * The register reads and opens; a review set is created from the matter it belongs to, which is
     * where its access list, its ceiling and its lifecycle are decided. What is alpha rather than
     * ready is everything past ingest: a document can be listed and narrowed, and coding, the
     * viewer, search and production are not built.
     *
     * Scoped by the per-review-set ACCESS LIST rather than by matter access, which is the row's
     * whole reason for being at the top level: a reviewer brought in for one production is on that
     * review set's list and may hold no access to the matter it belongs to, so a register reached
     * only through matters would hide from them precisely the work they were given.
     */
    stage: "alpha",
    defaultShown: true,
  },
  {
    // A safe for what the firm holds in stewardship (Trust keeps Landmark — institutional
    // client money — so the two stay distinct).
    id: "custodian",
    label: "Custodian",
    href: "/custodian",
    icon: Vault,
    description: "Evidence and holdings in the firm's stewardship, tracked end to end.",
    group: "work",
    shipped: true,
    // The register reads: what is held, where, for whom, what is overdue and what is under hold.
    // Logging a packet and recording a movement have no form behind them yet, and each control
    // says so where it stands.
    stage: "alpha",
    defaultShown: true,
  },
  // Money — in the order the money moves: hours and flat charges are recorded, disbursements are
  // advanced, then a bill claims all three and trust settles it.
  {
    // The period ledger: the firm's time over a span of days, across every matter. It is the read
    // surface, distinct from the top bar's Time Sheet, which is capture and opens over whatever
    // screen you are on. Alpha, not ready: the period reads, narrows and opens any entry, and the
    // week grid that captures a missed week in one pass is still to come.
    id: "time",
    label: "Time",
    href: "/time",
    icon: Clock,
    description: "Every hour recorded, across matters and timekeepers, for the days you choose.",
    group: "money",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    // The firm's fee record over a period, across every matter — the flat charges it made for work
    // done, and how much of that is still waiting on a bill. Fees was absent from this group for the
    // same structural reason Costs was: nothing served the record. It was not a Soon row, it was not
    // a row, and the fee work-in-progress store is what made adding it honest.
    //
    // It sits between Time and Costs because that is the order a matter's own Money group reads: the
    // two things a firm charges FOR its work, then the money it laid out doing it.
    id: "fees",
    label: "Fees",
    href: "/fees",
    icon: HandCoins,
    description: "Flat charges the firm made for its work, and what is still waiting on a bill.",
    group: "money",
    shipped: true,
    // The period reads, narrows and opens any fee in the shared record window. A fee's entry number
    // and the files riding it are still to come, and the firm's review setting is not served, so the
    // review verbs are absent rather than offered.
    stage: "alpha",
    defaultShown: true,
  },
  {
    // The firm's cost record over a period, across every matter — what was advanced, what is still
    // waiting on a bill, and what the firm decided to absorb. Costs was absent from this group
    // entirely while the matter's own Money group carried it, so the sidebar and the matter
    // disagreed about what Money holds; the reason was structural rather than an oversight, and
    // the listing's from/to span is what closed it.
    //
    // It sits between Time and Billing because that is the order the money moves: hours and
    // disbursements accrue, then a bill claims them. The matter's own Money group reads the same
    // way, with its Fees section between them.
    id: "costs",
    label: "Costs",
    href: "/costs",
    icon: Coins,
    description: "What the firm advanced for its matters, and what is still waiting on a bill.",
    group: "money",
    shipped: true,
    // The period reads, narrows and opens any cost in the shared record window. Approving a
    // submitted cost across matters, and the recorder each row is missing, are still to come.
    stage: "alpha",
    defaultShown: true,
  },
  {
    // The firm's own billing register: every bill for every client, newest first, with the
    // receivables aging over it. It is the read a matter's Billing section cannot give — a matter
    // knows its own account and no amount of visiting matters adds up to what the firm is owed.
    //
    // Alpha, not ready: the register reads, narrows by state, and opens any bill in the same window
    // the matter opens it in. The acts that move ONE matter's money are refused here by design and
    // say where they live; batch and recurring runs belong to the billing-automations slice.
    id: "billing",
    label: "Billing",
    href: "/billing",
    icon: ReceiptText,
    description: "Invoices, rates, and what the firm is owed.",
    group: "money",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    id: "trust",
    label: "Trust",
    href: "/trust",
    icon: Landmark,
    description: "Client money held in trust, to the penny.",
    group: "money",
    shipped: false,
    announced: true,
    defaultShown: true,
  },
  // Firm — the firm about itself.
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: ChartColumn,
    description: "The firm's numbers, sliced and exported.",
    group: "firm",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
  },
  {
    /*
     * What the firm is consuming: storage by class, matters by type and location, the versioning
     * breakdown, the Directory and member counts, the AI meters.
     *
     * IT IS NOT A TOOL, and it spent a while filed as one. A tool is a utility a member RUNS —
     * bring it a domain, an address, a file — and this runs nothing: it is the firm reading its own
     * records, which is exactly what the Firm group is for and exactly what Reports beside it does.
     * Filed under Tools it sat behind a heading nobody with a billing question would open (owner's
     * direction, 2026-09-16).
     *
     * It keeps the permission it was gated by as a tool. Renaming the key would be a migration
     * across the role seeds for no reader's benefit, and the key gates the same read either way;
     * what matters is that the gate travelled with the row, which is what `permission` here is for.
     */
    id: "firm-usage",
    label: "Firm Usage",
    href: "/firm-usage",
    icon: ChartPie,
    description: "See the firm's storage and platform consumption.",
    group: "firm",
    shipped: true,
    stage: "alpha",
    defaultShown: true,
    permission: assertPermission("tools:firmUsage"),
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Preferences for you; policy for the firm.",
    group: "firm",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultShown: true,
    footerPinned: true,
  },
] as const satisfies readonly Destination[];

/**
 * Every destination's id as a literal union. A screen names where its way back leads by one of
 * these, so a typo is a type error rather than a link that renders and goes nowhere.
 *
 * The union needs the list's LITERAL type, which is why the array above is `as const`. Every other
 * consumer wants the declared `Destination`, because an `as const` member loses the optional fields
 * it happens not to set — `pinned` stops existing on the rows that never had one, and every reader
 * of the registry breaks. So the literal list stays private and `DESTINATIONS` re-exports it at the
 * declared type: one array, two views of it.
 */
export type DestinationId = (typeof DESTINATION_LIST)[number]["id"];

export const DESTINATIONS: readonly Destination[] = DESTINATION_LIST;

/**
 * One destination by its registry id, or null. This is how a screen names where its way back
 * leads: the id resolves to the destination's real href, its user-facing label and its glyph, so a
 * back link cannot name a screen that does not exist or drift from what the sidebar calls it.
 */
export function destinationById(id: DestinationId): Destination | null {
  return DESTINATIONS.find((destination) => destination.id === id) ?? null;
}

/**
 * Whether this member may see a destination at all. A destination without a `permission` is a place
 * in the app rather than a capability, and every member with a seat may stand there; one with a
 * permission renders only for a member holding it.
 *
 * This is the gate, not the visibility preference: a member who cannot hold the key never sees the
 * row anywhere, including in Customize mode and in the palette, because a row offering a capability
 * access control has refused is a row that can only disappoint.
 */
export function isPermittedDestination(
  destination: Destination,
  permissions: ReadonlySet<Permission>,
): boolean {
  return destination.permission === undefined || permissions.has(destination.permission);
}

/**
 * Shipped plus announced-Soon destinations the member may see — what the palette presents. Never
 * filtered by the member's own show/hide preference: hiding a row from the rail must never remove
 * the capability, and searching for a thing is wanting it.
 */
export function visibleDestinations(permissions: ReadonlySet<Permission>): readonly Destination[] {
  return DESTINATIONS.filter(
    (destination) =>
      (destination.shipped || destination.announced === true) &&
      isPermittedDestination(destination, permissions),
  );
}

/** True when `pathname` lives under the destination (drives aria-current / the gilt bar). */
export function isCurrentDestination(destination: Destination, pathname: string): boolean {
  if (destination.exact === true) return pathname === destination.href;
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`);
}
