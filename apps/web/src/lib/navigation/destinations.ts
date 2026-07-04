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
 * starred rows render; everything else waits in the App Library (/library). `defaultStarred`
 * is the registry's half of that contract — the curated core arrives starred, exotic additions
 * arrive available-but-quiet.
 *
 * The Ctrl+K command palette (src/lib/components/command-palette.svelte) also renders from this
 * registry — adding a destination here is what makes it searchable; never hand-list it there.
 * Stars never touch the palette: hiding must never remove capability.
 */
import type { Component } from "svelte";
import House from "@lucide/svelte/icons/house";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import Users from "@lucide/svelte/icons/users";
import FileText from "@lucide/svelte/icons/file-text";
import ClipboardPenLine from "@lucide/svelte/icons/clipboard-pen-line";
import SquareCheck from "@lucide/svelte/icons/square-check";
import Inbox from "@lucide/svelte/icons/inbox";
import Clock from "@lucide/svelte/icons/clock";
import Landmark from "@lucide/svelte/icons/landmark";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import CreditCard from "@lucide/svelte/icons/credit-card";
import Calculator from "@lucide/svelte/icons/calculator";
import FileStack from "@lucide/svelte/icons/file-stack";
import FileSearch from "@lucide/svelte/icons/file-search";
import Settings from "@lucide/svelte/icons/settings";
import Vault from "@lucide/svelte/icons/vault";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import Wrench from "@lucide/svelte/icons/wrench";
import MessageSquare from "@lucide/svelte/icons/message-square";
import ChartColumn from "@lucide/svelte/icons/chart-column";
import Sparkles from "@lucide/svelte/icons/sparkles";

export type DestinationGroup = "top" | "money" | "practice" | "firm";

export interface Destination {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  readonly href: string;
  readonly icon: Component;
  /** One line for the App Library: what living here gets you. */
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
   * Cannot be unstarred — the App Library shows a locked star ("Always available"). Home and
   * Settings also hold fixed positions (Home first; Settings in its pinned footer home);
   * Matters is movable within its group but never hideable.
   */
  readonly pinned?: true;
  /**
   * The registry's half of the star contract: whether this destination arrives in a fresh
   * member's sidebar. The curated core is true; future exotic additions (and the App Library
   * itself) are false — available in the library, never pushed.
   */
  readonly defaultStarred: boolean;
  /**
   * Lives in the sidebar's pinned footer, not the scrolling groups (Settings). The groups
   * renderer skips it; the footer renders it from this entry so the row has one home.
   */
  readonly footerPinned?: true;
}

/** Group headings in canonical order; "top" is unlabelled (it opens the rail). */
export const DESTINATION_GROUPS: ReadonlyArray<{ id: DestinationGroup; label: string | null }> = [
  { id: "top", label: null },
  { id: "money", label: "Money" },
  { id: "practice", label: "Practice" },
  { id: "firm", label: "Firm" },
];

/*
 * ORDERING IS UNDER REVIEW (owner-directed draft, 2026-07-03): the announced Soon rows exist
 * precisely so the owner can feel the order — daily drivers and matter-work first, money next,
 * output last. It is data; reorder THIS array (and nothing else) to try another arrangement.
 * Members now reorder their OWN sidebars (the star layer), but this canonical order still
 * matters: it is every fresh sidebar, the App Library's order, and where reconciliation seats
 * new arrivals.
 */
export const DESTINATIONS: readonly Destination[] = [
  // Top — the owner's draft order: daily drivers, then the matter-work cluster.
  {
    id: "home",
    label: "Home",
    href: "/home",
    icon: House,
    description: "Your day at a glance — tasks, deadlines, and the matters you touch.",
    group: "top",
    shipped: true,
    pinned: true,
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
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
    icon: Users,
    description: "Clients, parties, counsel, and courts in one book.",
    group: "top",
    shipped: false,
    announced: true,
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
    shipped: false,
    announced: true,
    defaultStarred: true,
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: SquareCheck,
    description: "Work to do, assigned and tracked across matters.",
    group: "top",
    shipped: false,
    defaultStarred: false,
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
  {
    id: "payments",
    label: "Payments",
    href: "/payments",
    icon: CreditCard,
    description: "Card and bank payments from clients.",
    group: "money",
    shipped: false,
    defaultStarred: false,
  },
  {
    id: "accounting",
    label: "Accounting",
    href: "/accounting",
    icon: Calculator,
    description: "The firm's books and exports.",
    group: "money",
    shipped: false,
    defaultStarred: false,
  },
  // Practice
  {
    id: "templates",
    label: "Templates",
    href: "/templates",
    icon: FileStack,
    description: "Reusable document and matter templates.",
    group: "practice",
    shipped: false,
    defaultStarred: false,
  },
  {
    id: "safe-custody",
    label: "Safe custody",
    href: "/safe-custody",
    icon: Vault,
    description: "Original wills, deeds, and instruments in the firm's safe.",
    group: "practice",
    shipped: false,
    defaultStarred: false,
  },
  // Firm
  {
    id: "tools",
    label: "Tools",
    href: "/tools",
    icon: Wrench,
    description: "Standalone utilities — inspect, verify, repair, and convert files.",
    group: "firm",
    shipped: false,
    announced: true,
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
    // The catalog itself: reached from the sidebar's Customize mode and the palette, never
    // pushed into the sidebar (defaultStarred false) — a member who wants it one click away
    // stars it like anything else.
    id: "library",
    label: "App Library",
    href: "/library",
    icon: LayoutGrid,
    description: "Every Magna Carta app — star what belongs in your sidebar.",
    group: "firm",
    shipped: true,
    defaultStarred: false,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Preferences for you; policy for the firm.",
    group: "firm",
    shipped: true,
    pinned: true,
    defaultStarred: true,
    footerPinned: true,
  },
];

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
