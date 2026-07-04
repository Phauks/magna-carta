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
 * The Ctrl+K command palette (src/lib/components/command-palette.svelte) also renders from this
 * registry — adding a destination here is what makes the page searchable; never hand-list it there.
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
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import CreditCard from "@lucide/svelte/icons/credit-card";
import Calculator from "@lucide/svelte/icons/calculator";
import FileStack from "@lucide/svelte/icons/file-stack";
import FileSearch from "@lucide/svelte/icons/file-search";
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
  readonly group: DestinationGroup;
  /** Renders in the sidebar only when true — flipped when the surface's UI ships. */
  readonly shipped: boolean;
  /**
   * An unshipped destination the sidebar (and palette) already ANNOUNCE as a Soon row — the
   * owner is feeling out the ordering ahead of the builds. Flipping `shipped` retires the Soon
   * treatment; `announced` without `shipped` is the only combination that renders disabled.
   */
  readonly announced?: true;
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
 * At fifteen rows the sidebar is nearing the length where it wants GROUPING (the settings
 * nav's band device) — the expected next step once the owner settles membership and order;
 * not built yet.
 */
export const DESTINATIONS: readonly Destination[] = [
  // Top — the owner's draft order: daily drivers, then the matter-work cluster.
  { id: "home", label: "Home", href: "/home", icon: House, group: "top", shipped: true },
  {
    // Magnus — the Magna Carta assistant. It will converse inside a matter and around the
    // app, but this is its always-reachable home: one sidebar entry, easy to find at all
    // times (owner-directed). A stub only until the assistant ships.
    id: "magnus",
    label: "Magnus",
    href: "/magnus",
    icon: Sparkles,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    id: "matters",
    label: "Matters",
    href: "/matters",
    icon: FolderOpen,
    group: "top",
    shipped: true,
  },
  {
    id: "intake",
    label: "Intake",
    href: "/intake",
    icon: Inbox,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    // Runs at intake, so it sits beside it.
    id: "conflicts",
    label: "Conflicts Check",
    href: "/conflicts",
    icon: ShieldAlert,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
    icon: Users,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    // Client and portal communications.
    id: "communications",
    label: "Messaging",
    href: "/communications",
    icon: MessageSquare,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileText,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    // Document automation and court forms — the documents cluster, distinct glyph from
    // Documents itself.
    id: "forms",
    label: "Forms",
    href: "/forms",
    icon: ClipboardPenLine,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    // The evidence cluster: discovery beside its custodian stewardship.
    id: "discovery",
    label: "Discovery",
    href: "/discovery",
    icon: FileSearch,
    group: "top",
    shipped: false,
    announced: true,
  },
  {
    // A safe for what the firm holds in stewardship (Trust keeps Landmark — institutional
    // client money — so the two stay distinct).
    id: "custodian",
    label: "Custodian",
    href: "/custodian",
    icon: Vault,
    group: "top",
    shipped: false,
    announced: true,
  },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: SquareCheck, group: "top", shipped: false },
  // Money (draft order: Time, Billing, Trust)
  {
    id: "time",
    label: "Time",
    href: "/time",
    icon: Clock,
    group: "money",
    shipped: false,
    announced: true,
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    icon: ReceiptText,
    group: "money",
    shipped: false,
    announced: true,
  },
  {
    id: "trust",
    label: "Trust",
    href: "/trust",
    icon: Landmark,
    group: "money",
    shipped: false,
    announced: true,
  },
  {
    id: "payments",
    label: "Payments",
    href: "/payments",
    icon: CreditCard,
    group: "money",
    shipped: false,
  },
  {
    id: "accounting",
    label: "Accounting",
    href: "/accounting",
    icon: Calculator,
    group: "money",
    shipped: false,
  },
  // Practice
  {
    id: "templates",
    label: "Templates",
    href: "/templates",
    icon: FileStack,
    group: "practice",
    shipped: false,
  },
  {
    id: "safe-custody",
    label: "Safe custody",
    href: "/safe-custody",
    icon: Vault,
    group: "practice",
    shipped: false,
  },
  // Firm
  {
    id: "tools",
    label: "Tools",
    href: "/tools",
    icon: Wrench,
    group: "firm",
    shipped: false,
    announced: true,
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: ChartColumn,
    group: "firm",
    shipped: false,
    announced: true,
  },
];

/** The sidebar's render list: shipped destinations, canonical order, grouped. */
export function shippedDestinations(): readonly Destination[] {
  return DESTINATIONS.filter((destination) => destination.shipped);
}

/** Shipped plus announced-Soon destinations — what the sidebar and palette present. */
export function visibleDestinations(): readonly Destination[] {
  return DESTINATIONS.filter(
    (destination) => destination.shipped || destination.announced === true,
  );
}

/** True when `pathname` lives under the destination (drives aria-current / the gilt bar). */
export function isCurrentDestination(destination: Destination, pathname: string): boolean {
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`);
}
