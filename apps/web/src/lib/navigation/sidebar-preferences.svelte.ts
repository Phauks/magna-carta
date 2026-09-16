/*
 * Per-member sidebar preferences — the STAR layer over the canonical destination registry
 * (destinations.ts), on the shared persisted-preference primitive. The registry stays the truth
 * about what exists; this store holds only what THIS member shows and in what per-group order. The
 * primitive owns the localStorage read/write, the SSR guard, and the cross-tab follower; the
 * normalize below is this store's read-time validator (unknown ids drop; the shape is rebuilt
 * fresh), applied to first read and to any payload arriving from another tab.
 *
 * INVARIANT — STARS GOVERN THE SIDEBAR ONLY. Every destination stays reachable through the command
 * palette regardless of stars, and Customize mode reveals every destination for re-adding: hiding
 * must never remove capability — searching for a thing is wanting it.
 *
 * Storage shape (localStorage, per browser):
 * - `starredOverrides` records only DEPARTURES from the registry's defaultStarred, so a new
 *   registry destination shipped with defaultStarred true arrives starred even for members with
 *   long-standing customizations — additions surface predictably.
 * - `order` is per group, and holds ONLY ids the member has actually arranged. RECONCILIATION
 *   RULE: a starred id absent from the stored order enters at its CANONICAL position relative to
 *   the member's arrangement (mergeGroupOrder below); ids gone from the registry drop on read.
 * - `known` is arrival bookkeeping: ids that have appeared in this member's sidebar before. A
 *   visible id not yet known is a NEW ARRIVAL — the shell gives it a one-time gilt-draw highlight
 *   so the eye catches where it landed, then acknowledges it into `known`.
 * - `expandOnHover` is a per-browser interaction preference (default off): when the rail rests
 *   collapsed, hovering it floats the rail open as an overlay over the canvas.
 * - `collapsedGroups` names the groups this member has FOLDED AWAY. Departures again, not state:
 *   every group is open until somebody folds it, so a group added to the registry later arrives
 *   open rather than inheriting a fold nobody asked for. Folding hides rows the way a star does,
 *   and carries the same invariant — the palette still reaches every destination in a folded
 *   group, because hiding must never remove capability.
 */

import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import {
  DESTINATION_GROUPS,
  DESTINATIONS,
  type Destination,
  type DestinationGroup,
} from "./destinations.ts";
import { FIXED_LEADING_ID, mergeGroupOrder } from "./sidebar-order.ts";
import { toolSidebarDestinations } from "./tool-sidebar.ts";

const STORAGE_KEY = "mc-sidebar-preferences";

interface SidebarPreferencesValue {
  starredOverrides: Record<string, boolean>;
  order: Partial<Record<DestinationGroup, string[]>>;
  known: string[];
  expandOnHover: boolean;
  collapsedGroups: DestinationGroup[];
}

const REGISTRY_IDS = new Set(DESTINATIONS.map((destination) => destination.id));

/** What a pristine sidebar shows — the registry's pinned + default-starred rows. */
function defaultVisibleIds(): string[] {
  return DESTINATIONS.filter(
    (destination) => destination.pinned === true || destination.defaultStarred,
  ).map((destination) => destination.id);
}

function emptyValue(): SidebarPreferencesValue {
  // `known` seeds to the default-visible set: a fresh sidebar is not a wall of arrivals — the gilt
  // highlight is for rows that land LATER (a star elsewhere, a new registry addition).
  return {
    starredOverrides: {},
    order: {},
    known: defaultVisibleIds(),
    expandOnHover: false,
    collapsedGroups: [],
  };
}

/** Read-time validator: unknown ids (retired registry rows, hand edits) drop; the shape rebuilds. */
function normalize(parsed: unknown): SidebarPreferencesValue {
  const value = emptyValue();
  if (parsed === null || typeof parsed !== "object") return value;
  const record = parsed as Partial<SidebarPreferencesValue>;
  if (record.starredOverrides !== null && typeof record.starredOverrides === "object") {
    for (const [id, starred] of Object.entries(record.starredOverrides)) {
      if (REGISTRY_IDS.has(id) && typeof starred === "boolean") {
        value.starredOverrides[id] = starred;
      }
    }
  }
  if (record.order !== null && typeof record.order === "object") {
    for (const group of DESTINATION_GROUPS) {
      const stored = (record.order as Record<string, unknown>)[group.id];
      if (Array.isArray(stored)) {
        const ids = stored.filter(
          (id): id is string => typeof id === "string" && REGISTRY_IDS.has(id),
        );
        if (ids.length > 0) value.order[group.id] = ids;
      }
    }
  }
  if (Array.isArray(record.known)) {
    value.known = record.known.filter(
      (id): id is string => typeof id === "string" && REGISTRY_IDS.has(id),
    );
  }
  if (typeof record.expandOnHover === "boolean") {
    value.expandOnHover = record.expandOnHover;
  }
  if (Array.isArray(record.collapsedGroups)) {
    const groupIds = new Set<string>(DESTINATION_GROUPS.map((group) => group.id));
    value.collapsedGroups = record.collapsedGroups.filter(
      (id): id is DestinationGroup => typeof id === "string" && groupIds.has(id),
    );
  }
  return value;
}

const preference = createPersistedPreference(
  jsonPreference<SidebarPreferencesValue>(STORAGE_KEY, normalize),
);
preference.followAcrossTabs();

function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((destination) => destination.id === id);
}

/** Pinned rows are always on; otherwise the member's override wins over the registry default. */
export function isStarred(destination: Destination): boolean {
  if (destination.pinned === true) return true;
  return preference.current.starredOverrides[destination.id] ?? destination.defaultStarred;
}

export interface SidebarGroupView {
  readonly id: DestinationGroup;
  readonly label: string;
  readonly destinations: readonly Destination[];
}

/**
 * The sidebar's render tree: per group, the pinned + starred destinations in the member's
 * reconciled order. Footer-pinned rows (Settings, Downloads, Uploads) are excluded — the footer's
 * utility tray renders them.
 */
export function sidebarGroups(): readonly SidebarGroupView[] {
  return DESTINATION_GROUPS.map((group) => {
    const visibleCanonical = DESTINATIONS.filter(
      (destination) =>
        destination.group === group.id &&
        destination.footerPinned !== true &&
        isStarred(destination),
    ).map((destination) => destination.id);
    const orderedIds = mergeGroupOrder(visibleCanonical, preference.current.order[group.id] ?? []);
    const registryRows = orderedIds
      .map((id) => destinationById(id))
      .filter((destination): destination is Destination => destination !== undefined);
    return {
      id: group.id,
      label: group.label,
      // The Tools group is the registry's index row followed by the tool catalog itself, which
      // this registry deliberately does not hold (navigation/tool-sidebar.ts). Appended rather
      // than merged into the order above because the catalog's own subject order is the order —
      // there is no member arrangement over it to reconcile with.
      destinations:
        group.id === "tools" ? [...registryRows, ...toolSidebarDestinations()] : registryRows,
    };
  }).filter((group) => group.destinations.length > 0);
}

export interface SidebarEditingGroupView {
  readonly id: DestinationGroup;
  readonly label: string;
  /** In the sidebar now — pinned + starred, in the member's reconciled order (draggable). */
  readonly starred: readonly Destination[];
  /** Hidden from the sidebar — offered in canonical order, one click to add back. */
  readonly unstarred: readonly Destination[];
}

/**
 * The Customize-mode render tree: per group, EVERY destination split into the two tiers the editor
 * shows — the ones in the sidebar now (starred, member order) and the ones a click would add
 * (unstarred, canonical order). Footer-pinned rows (Settings, Downloads, Uploads) are excluded —
 * the footer's utility tray owns them, so they are never hideable or reorderable.
 *
 * THE TOOLS GROUP IS EXCLUDED WHOLE. What a member sees there is what they are permitted to run,
 * and access control has already answered that; a star beside a tool would be a second answer to
 * the same question, and an inert one. The group folds away like any other if the rail is too
 * long, which is the control that actually belongs to the reader.
 * This is the editor's superset of sidebarGroups(), which shows only the starred tier.
 */
export function sidebarEditingGroups(): readonly SidebarEditingGroupView[] {
  return DESTINATION_GROUPS.filter((group) => group.id !== "tools")
    .map((group) => {
      const members = DESTINATIONS.filter(
        (destination) => destination.group === group.id && destination.footerPinned !== true,
      );
      const starredCanonical = members
        .filter((destination) => isStarred(destination))
        .map((destination) => destination.id);
      const orderedStarredIds = mergeGroupOrder(
        starredCanonical,
        preference.current.order[group.id] ?? [],
      );
      const starred = orderedStarredIds
        .map((id) => destinationById(id))
        .filter((destination): destination is Destination => destination !== undefined);
      // Canonical order for the add-back tier — the members array is already canonical.
      const unstarred = members.filter((destination) => !isStarred(destination));
      return { id: group.id, label: group.label, starred, unstarred };
    })
    .filter((group) => group.starred.length + group.unstarred.length > 0);
}

/** A visible id the member's sidebar has never carried before — highlight once, then acknowledge. */
export function isNewArrival(id: string): boolean {
  return !preference.current.known.includes(id);
}

/** Called by the shell once the arrival highlight has played; persists so it plays only once. */
export function acknowledgeArrival(id: string): void {
  if (preference.current.known.includes(id)) return;
  preference.set({ ...preference.current, known: [...preference.current.known, id] });
}

export function setStarred(id: string, next: boolean): void {
  const destination = destinationById(id);
  if (destination === undefined || destination.pinned === true) return;
  const current = preference.current;
  // Store only departures from the registry default, so future default changes reach members who
  // never touched this row.
  let starredOverrides: Record<string, boolean>;
  if (next === destination.defaultStarred) {
    const { [id]: dropped, ...rest } = current.starredOverrides;
    void dropped;
    starredOverrides = rest;
  } else {
    starredOverrides = { ...current.starredOverrides, [id]: next };
  }
  // Adding a row back replays its one-time gilt-draw arrival: forgetting it from `known` lets the
  // shell catch it as a NEW ARRIVAL where reconciliation seats it, then re-acknowledge it. Removing
  // never highlights (there is nothing to draw attention to).
  const known = next ? current.known.filter((knownId) => knownId !== id) : current.known;
  preference.set({ ...current, starredOverrides, known });
}

/**
 * Reorder within a group (Customize mode). The whole reconciled arrangement is folded into storage
 * on the first move, so subsequent merges are stable around it.
 */
export function moveDestination(group: DestinationGroup, id: string, toIndex: number): void {
  if (id === FIXED_LEADING_ID) return;
  const groupView = sidebarGroups().find((candidate) => candidate.id === group);
  if (groupView === undefined) return;
  const ids = groupView.destinations.map((destination) => destination.id);
  const fromIndex = ids.indexOf(id);
  if (fromIndex === -1) return;
  const minimumIndex = ids[0] === FIXED_LEADING_ID ? 1 : 0;
  const boundedIndex = Math.max(minimumIndex, Math.min(ids.length - 1, toIndex));
  if (boundedIndex === fromIndex) return;
  ids.splice(fromIndex, 1);
  ids.splice(boundedIndex, 0, id);
  preference.set({ ...preference.current, order: { ...preference.current.order, [group]: ids } });
}

/**
 * Whether a group is folded away in this member's rail. Read reactively.
 *
 * The COLLAPSED ICON RAIL is not this: a rail with no visible headings has nothing to fold by, so
 * the shell shows every group's icons there whatever this says, and the fold is waiting when the
 * rail is opened again.
 */
export function isGroupCollapsed(group: DestinationGroup): boolean {
  return preference.current.collapsedGroups.includes(group);
}

export function setGroupCollapsed(group: DestinationGroup, next: boolean): void {
  if (isGroupCollapsed(group) === next) return;
  const collapsedGroups = next
    ? [...preference.current.collapsedGroups, group]
    : preference.current.collapsedGroups.filter((id) => id !== group);
  preference.set({ ...preference.current, collapsedGroups });
}

export function toggleGroupCollapsed(group: DestinationGroup): void {
  setGroupCollapsed(group, !isGroupCollapsed(group));
}

/** The hover-to-expand preference — read reactively; default off. */
export function expandSidebarOnHover(): boolean {
  return preference.current.expandOnHover;
}

export function setExpandSidebarOnHover(next: boolean): void {
  if (preference.current.expandOnHover === next) return;
  preference.set({ ...preference.current, expandOnHover: next });
}
