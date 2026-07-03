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
 */
import type { Component } from "svelte";
import House from "@lucide/svelte/icons/house";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Calendar from "@lucide/svelte/icons/calendar";
import Users from "@lucide/svelte/icons/users";
import SquareCheck from "@lucide/svelte/icons/square-check";
import Inbox from "@lucide/svelte/icons/inbox";
import Clock from "@lucide/svelte/icons/clock";
import Landmark from "@lucide/svelte/icons/landmark";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import CreditCard from "@lucide/svelte/icons/credit-card";
import Calculator from "@lucide/svelte/icons/calculator";
import FileStack from "@lucide/svelte/icons/file-stack";
import SearchCheck from "@lucide/svelte/icons/search-check";
import Vault from "@lucide/svelte/icons/vault";
import Scale from "@lucide/svelte/icons/scale";
import Wrench from "@lucide/svelte/icons/wrench";
import Mail from "@lucide/svelte/icons/mail";
import ChartColumn from "@lucide/svelte/icons/chart-column";

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
}

/** Group headings in canonical order; "top" is unlabelled (it opens the rail). */
export const DESTINATION_GROUPS: ReadonlyArray<{ id: DestinationGroup; label: string | null }> = [
  { id: "top", label: null },
  { id: "money", label: "Money" },
  { id: "practice", label: "Practice" },
  { id: "firm", label: "Firm" },
];

export const DESTINATIONS: readonly Destination[] = [
  // Top
  { id: "home", label: "Home", href: "/", icon: House, group: "top", shipped: true },
  {
    id: "matters",
    label: "Matters",
    href: "/matters",
    icon: FolderOpen,
    group: "top",
    shipped: true,
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: Calendar,
    group: "top",
    shipped: false,
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
    icon: Users,
    group: "top",
    shipped: false,
  },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: SquareCheck, group: "top", shipped: false },
  { id: "intake", label: "Intake", href: "/intake", icon: Inbox, group: "top", shipped: false },
  // Money
  { id: "time", label: "Time", href: "/time", icon: Clock, group: "money", shipped: false },
  { id: "trust", label: "Trust", href: "/trust", icon: Landmark, group: "money", shipped: false },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    icon: ReceiptText,
    group: "money",
    shipped: false,
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
    id: "discovery",
    label: "Discovery",
    href: "/discovery",
    icon: SearchCheck,
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
  {
    id: "conflicts",
    label: "Conflicts",
    href: "/conflicts",
    icon: Scale,
    group: "practice",
    shipped: false,
  },
  // Firm
  { id: "tools", label: "Tools", href: "/tools", icon: Wrench, group: "firm", shipped: false },
  {
    id: "communications",
    label: "Communications",
    href: "/communications",
    icon: Mail,
    group: "firm",
    shipped: false,
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: ChartColumn,
    group: "firm",
    shipped: false,
  },
];

/** The sidebar's render list: shipped destinations, canonical order, grouped. */
export function shippedDestinations(): readonly Destination[] {
  return DESTINATIONS.filter((destination) => destination.shipped);
}

/** True when `pathname` lives under the destination (drives aria-current / the gilt bar). */
export function isCurrentDestination(destination: Destination, pathname: string): boolean {
  if (destination.href === "/") return pathname === "/";
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`);
}
