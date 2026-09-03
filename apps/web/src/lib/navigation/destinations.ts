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
 * THE STAR LAYER: this registry stays canonical — membership, groups, canonical order, the
 * shipped/announced light-ups. WHICH rows the sidebar shows, and in what per-group order, is
 * the member's own preference (src/lib/navigation/sidebar-preferences.svelte.ts): pinned +
 * starred rows render; everything else is added back from the sidebar's own Customize mode,
 * which reveals every destination grouped. `defaultStarred` is the registry's half of that
 * contract — the curated core arrives starred, exotic additions arrive available-but-quiet.
 *
 * ONLY REAL THINGS (owner-directed): every entry is either `shipped` (its user-facing surface
 * exists) or `announced` (an owner-curated Soon stub the sidebar and palette pre-announce ahead
 * of the build). Nothing speculative lives here — the sidebar is a promise to the user, not an
 * inventory of the backlog.
 *
 * The Ctrl+K command palette (src/lib/components/command-palette.svelte) also renders from this
 * registry — adding a destination here is what makes it searchable; never hand-list it there.
 * Stars never touch the palette: hiding must never remove capability.
 */
import type { Component } from "svelte";
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import House from "@lucide/svelte/icons/house";
import Download from "@lucide/svelte/icons/download";
import Bell from "@lucide/svelte/icons/bell";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import Users from "@lucide/svelte/icons/users";
import FileText from "@lucide/svelte/icons/file-text";
import ClipboardPenLine from "@lucide/svelte/icons/clipboard-pen-line";
import Inbox from "@lucide/svelte/icons/inbox";
import Clock from "@lucide/svelte/icons/clock";
import Landmark from "@lucide/svelte/icons/landmark";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import FileSearch from "@lucide/svelte/icons/file-search";
import Settings from "@lucide/svelte/icons/settings";
import Vault from "@lucide/svelte/icons/vault";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import Wrench from "@lucide/svelte/icons/wrench";
import MessageSquare from "@lucide/svelte/icons/message-square";
import ChartColumn from "@lucide/svelte/icons/chart-column";
import Sparkles from "@lucide/svelte/icons/sparkles";
import ListChecks from "@lucide/svelte/icons/list-checks";

export type DestinationGroup = "top" | "money" | "firm";

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
   * Cannot be unstarred — Customize mode shows a lock instead of a star ("always in your
   * sidebar"). Home and Settings also hold fixed positions (Home first; Settings in its pinned
   * footer home); Matters is movable within its group but never hideable.
   */
  readonly pinned?: true;
  /**
   * The registry's half of the star contract: whether this destination arrives in a fresh
   * member's sidebar. The curated core is true; future exotic additions arrive false —
   * revealed in Customize mode and added by a click, never pushed.
   */
  readonly defaultStarred: boolean;
  /**
   * Lives in the sidebar's pinned footer, not the scrolling groups (Settings). The groups
   * renderer skips it; the footer renders it from this entry so the row has one home.
   */
  readonly footerPinned?: true;
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
 * Group headings in canonical order. Every group carries a heading now (owner-directed — a
 * headless top group read as unbalanced against the labelled ones): "Workspace" is the
 * matter/document daily surfaces, "Money" the ledger, "Firm" the firm-wide tools.
 */
export const DESTINATION_GROUPS: ReadonlyArray<{ id: DestinationGroup; label: string }> = [
  { id: "top", label: "Workspace" },
  { id: "money", label: "Money" },
  { id: "firm", label: "Firm" },
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
  // Workspace — the owner's draft order: daily drivers, then the matter-work cluster.
  {
    id: "home",
    label: "Home",
    href: "/home",
    icon: House,
    description: "Your day at a glance — tasks, deadlines, and the matters you touch.",
    group: "top",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultStarred: true,
  },
  {
    // The download register: what the platform produced for this member, kept for a short window so
    // it can be taken again. Deliberately NOT the notification feed — that surface carries the
    // firm's work, and a generated file is platform mechanics (owner ruling, 2026-08-31).
    id: "downloads",
    label: "Downloads",
    href: "/downloads",
    icon: Download,
    description: "Reports and files the platform made for you, ready to download again.",
    group: "top",
    shipped: true,
    stage: "alpha",
    defaultStarred: true,
  },
  {
    // A shipped stub: the page exists (an honest empty state) so the top-bar bell has a home to
    // open into. The alerts machinery that fills it arrives later.
    id: "notifications",
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    description: "Alerts, mentions, and updates across your matters.",
    group: "top",
    shipped: true,
    stage: "alpha",
    defaultStarred: true,
  },
  {
    // The member's own work, across every matter they can see plus their own tasks on no matter.
    // It sits in the workspace group beside Notifications rather than under a matter, because "what
    // is on my plate" is a question about the person and not about any one case — and a task list
    // somebody has to go looking for inside each matter is a task list nobody looks at.
    id: "my-work",
    label: "My Work",
    href: "/tasks",
    icon: ListChecks,
    description: "Every task with your name on it, across your matters and the firm's own work.",
    group: "top",
    shipped: true,
    stage: "alpha",
    defaultStarred: true,
  },
  {
    // Magnus — the Magna Carta assistant. It will converse inside a matter and around the
    // app, but this is its always-reachable home: one sidebar entry, easy to find at all
    // times (owner-directed). A stub only until the assistant ships.
    id: "magnus",
    label: "Magnus",
    href: "/magnus",
    icon: Sparkles,
    description: "The Magna Carta assistant — ask, draft, and navigate in plain language.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    description: "Deadlines, hearings, and appointments across the firm.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "matters",
    label: "Matters",
    href: "/matters",
    icon: FolderOpen,
    description: "Every matter the firm holds — the work's home.",
    group: "top",
    shipped: true,
    stage: "alpha",
    pinned: true,
    defaultStarred: true,
  },
  {
    id: "intake",
    label: "Intake",
    href: "/intake",
    icon: Inbox,
    description: "New client and matter intake, from first inquiry to open file.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    // Runs at intake, so it sits beside it.
    id: "conflicts",
    label: "Conflicts Check",
    href: "/conflicts",
    icon: ShieldAlert,
    description: "Conflict checks run at intake and on demand.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "directory",
    label: "Directory",
    href: "/directory",
    icon: Users,
    description: "Clients, parties, counsel, and courts in one book.",
    group: "top",
    shipped: true,
    // Alpha, not ready: the record is searched rather than browsed, and three of its panes render
    // their shape while their reads are built.
    stage: "alpha",
    defaultStarred: true,
  },
  {
    // Client and portal communications.
    id: "communications",
    label: "Messaging",
    href: "/communications",
    icon: MessageSquare,
    description: "Client and portal messages, kept with their matters.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileText,
    description: "The firm's documents — stored, scanned, and versioned.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    // Document automation and court forms — the documents cluster, distinct glyph from
    // Documents itself.
    id: "forms",
    label: "Forms",
    href: "/forms",
    icon: ClipboardPenLine,
    description: "Document automation and court forms.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    // The evidence cluster: discovery beside its custodian stewardship.
    id: "discovery",
    label: "Discovery",
    href: "/discovery",
    icon: FileSearch,
    description: "Discovery review and production.",
    group: "top",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    // A safe for what the firm holds in stewardship (Trust keeps Landmark — institutional
    // client money — so the two stay distinct).
    id: "custodian",
    label: "Custodian",
    href: "/custodian",
    icon: Vault,
    description: "Evidence and holdings in the firm's stewardship, tracked end to end.",
    group: "top",
    shipped: true,
    // The register reads: what is held, where, for whom, what is overdue and what is under hold.
    // Logging a packet and recording a movement have no form behind them yet, and each control
    // says so where it stands.
    stage: "alpha",
    defaultStarred: true,
  },
  // Money (draft order: Time, Billing, Trust)
  {
    id: "time",
    label: "Time",
    href: "/time",
    icon: Clock,
    description: "Time capture and entries, ready for billing.",
    group: "money",
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    icon: ReceiptText,
    description: "Invoices, rates, and what the firm is owed.",
    group: "money",
    shipped: false,
    announced: true,
    defaultStarred: true,
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
    defaultStarred: true,
  },
  // Firm
  {
    id: "tools",
    label: "Tools",
    href: "/tools",
    icon: Wrench,
    description: "Standalone utilities — inspect, verify, repair, and convert files.",
    group: "firm",
    shipped: true,
    stage: "alpha",
    defaultStarred: true,
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: ChartColumn,
    description: "The firm's numbers, sliced and exported.",
    group: "firm",
    shipped: false,
    announced: true,
    defaultStarred: true,
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
    defaultStarred: true,
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

/** Shipped plus announced-Soon destinations — what the palette presents (never star-filtered). */
export function visibleDestinations(): readonly Destination[] {
  return DESTINATIONS.filter(
    (destination) => destination.shipped || destination.announced === true,
  );
}

/** True when `pathname` lives under the destination (drives aria-current / the gilt bar). */
export function isCurrentDestination(destination: Destination, pathname: string): boolean {
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`);
}
