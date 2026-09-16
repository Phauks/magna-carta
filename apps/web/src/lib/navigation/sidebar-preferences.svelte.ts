/*
 * Per-member sidebar preferences — the VISIBILITY layer over the canonical destination registry
 * (destinations.ts), on the shared persisted-preference primitive. The registry stays the truth
 * about what exists; this store holds only what THIS member shows and in what per-group order. The
 * primitive owns the localStorage read/write, the SSR guard, and the cross-tab follower; the
 * normalize below is this store's read-time validator (unknown ids drop; the shape is rebuilt
 * fresh), applied to first read and to any payload arriving from another tab.
 *
 * INVARIANT — HIDING GOVERNS THE SIDEBAR ONLY. Every destination stays reachable through the command
 * palette regardless, and Customize mode reveals every destination for bringing back: hiding must
 * never remove capability — searching for a thing is wanting it.
 *
 * THREE LAYERS, THREE MEANINGS, THREE MARKS (owner ruling, 2026-09-16):
 *   - SHOW/HIDE (the eye) — whether a destination the platform ships appears in its group. This
 *     store.
 *   - FAVOURITE (the star) — the member's own shortcut to any address at all, platform row or not.
 *     navigation/favorites.svelte.ts; rendered as the rail's first group.
 *   - PERMISSION — whether the member may see the thing at all. Access control's, never a
 *     preference's: a row gated by a permission the member lacks is absent everywhere, including
 *     from Customize mode.
 *
 * Storage shape (localStorage, per browser):
 * - `visibilityOverrides` records only DEPARTURES from the registry's defaultShown, so a new registry
 *   destination shipped with defaultShown true arrives visible even for members with long-standing
 *   customizations — additions surface predictably.
 * - `order` is per group, and holds ONLY ids the member has actually arranged. RECONCILIATION
 *   RULE: a shown id absent from the stored order enters at its CANONICAL position relative to
 *   the member's arrangement (mergeGroupOrder below); ids gone from the registry drop on read.
 * - `known` is arrival bookkeeping: ids that have appeared in this member's sidebar before. A
 *   visible id not yet known is a NEW ARRIVAL — the shell gives it a one-time gilt-draw highlight
 *   so the eye catches where it landed, then acknowledges it into `known`.
 * - `expandOnHover` is a per-browser interaction preference (default off): when the rail rests
 *   collapsed, hovering it floats the rail open as an overlay over the canvas.
 * - `collapsedGroups` names the groups this member has FOLDED AWAY, and `collapsedClusters` the
 *   sub-menus. Departures again, not state: everything is open until somebody folds it, so a group
 *   or cluster added later arrives open rather than inheriting a fold nobody asked for. Folding
 *   hides rows the way the eye does, and carries the same invariant — the palette still reaches
 *   every destination inside a fold, because hiding must never remove capability.
 */

import type { Component } from "svelte";
import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { grantedPermissions } from "$lib/tools/tool-permissions.ts";
import {
  DESTINATION_GROUPS,
  DESTINATIONS,
  isPermittedDestination,
  type Destination,
  type DestinationGroup,
} from "./destinations.ts";
import { clusterById } from "./clusters.ts";
import { FIXED_LEADING_ID, mergeGroupOrder } from "./sidebar-order.ts";
import { toolSidebarDestinations } from "./tool-sidebar.ts";
import {
  favoriteDestinations,
  favoritePathFromRowId,
  moveFavorite,
  removeFavorite,
} from "./favorites.svelte.ts";

const STORAGE_KEY = "mc-sidebar-preferences";

interface SidebarPreferencesValue {
  visibilityOverrides: Record<string, boolean>;
  order: Partial<Record<DestinationGroup, string[]>>;
  known: string[];
  expandOnHover: boolean;
  collapsedGroups: DestinationGroup[];
  collapsedClusters: string[];
}

const REGISTRY_IDS = new Set(DESTINATIONS.map((destination) => destination.id));

/** What a pristine sidebar shows — the registry's pinned + default-shown rows. */
function defaultVisibleIds(): string[] {
  return DESTINATIONS.filter(
    (destination) => destination.pinned === true || destination.defaultShown,
  ).map((destination) => destination.id);
}

function emptyValue(): SidebarPreferencesValue {
  // `known` seeds to the default-visible set: a fresh sidebar is not a wall of arrivals — the gilt
  // highlight is for rows that land LATER (brought back in Customize, or a new registry addition).
  return {
    visibilityOverrides: {},
    order: {},
    known: defaultVisibleIds(),
    expandOnHover: false,
    collapsedGroups: [],
    collapsedClusters: [],
  };
}

/** Read-time validator: unknown ids (retired registry rows, hand edits) drop; the shape rebuilds. */
function normalize(parsed: unknown): SidebarPreferencesValue {
  const value = emptyValue();
  if (parsed === null || typeof parsed !== "object") return value;
  const record = parsed as Partial<SidebarPreferencesValue>;
  if (record.visibilityOverrides !== null && typeof record.visibilityOverrides === "object") {
    for (const [id, shown] of Object.entries(record.visibilityOverrides)) {
      if (REGISTRY_IDS.has(id) && typeof shown === "boolean") {
        value.visibilityOverrides[id] = shown;
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
  if (Array.isArray(record.collapsedClusters)) {
    value.collapsedClusters = record.collapsedClusters.filter(
      (id): id is string => typeof id === "string" && clusterById(id) !== null,
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

/** Every registry destination this member may see at all — the permission gate, not a preference. */
function permittedDestinations(): readonly Destination[] {
  const permissions = grantedPermissions();
  return DESTINATIONS.filter((destination) => isPermittedDestination(destination, permissions));
}

/** Pinned rows are always on; otherwise the member's override wins over the registry default. */
export function isShown(destination: Destination): boolean {
  if (destination.pinned === true) return true;
  return preference.current.visibilityOverrides[destination.id] ?? destination.defaultShown;
}

/**
 * One row, or one fold holding several. The rail's render tree is a list of these per group, which
 * is what lets any group carry a sub-menu without the shell learning a second shape.
 */
export type SidebarNode =
  | { readonly kind: "row"; readonly destination: Destination }
  | {
      readonly kind: "cluster";
      readonly id: string;
      readonly label: string;
      readonly icon: Component;
      readonly rows: readonly Destination[];
    };

export interface SidebarGroupView {
  readonly id: DestinationGroup;
  readonly label: string;
  /** Flat — every row the group holds, folded or not. The collapsed icon rail draws this. */
  readonly destinations: readonly Destination[];
  /** Folded — rows and clusters, in render order. The expanded rail draws this. */
  readonly nodes: readonly SidebarNode[];
}

/**
 * Rows folded into their clusters. A cluster is seated where its FIRST member sits, so a member's
 * own arrangement still decides where the fold lands; a cluster holding one row is not a fold at
 * all and its row is seated plainly, because a chevron hiding one thing costs a press and saves
 * nothing.
 */
function foldIntoClusters(rows: readonly Destination[]): SidebarNode[] {
  const nodes: SidebarNode[] = [];
  const seated = new Set<string>();
  for (const destination of rows) {
    const clusterId = destination.cluster;
    if (clusterId === undefined) {
      nodes.push({ kind: "row", destination });
      continue;
    }
    if (seated.has(clusterId)) continue;
    seated.add(clusterId);
    const members = rows.filter((candidate) => candidate.cluster === clusterId);
    const cluster = clusterById(clusterId);
    if (cluster === null || members.length < 2) {
      for (const member of members) nodes.push({ kind: "row", destination: member });
      continue;
    }
    nodes.push({
      kind: "cluster",
      id: cluster.id,
      label: cluster.label,
      icon: cluster.icon,
      rows: members,
    });
  }
  return nodes;
}

/**
 * The rail's render tree: per group, the pinned + shown destinations in the member's reconciled
 * order, folded into clusters. Footer-pinned rows (Settings, Downloads, Uploads) are excluded — the
 * footer's utility tray renders them.
 *
 * Two groups hold rows this registry does not declare, each for its own reason. TOOLS is the tool
 * catalog projected (tool-sidebar.ts), because what a tool is has one home and it is not this file.
 * FAVOURITES is the member's own (favorites.svelte.ts), because the platform cannot know which of
 * ten thousand matters somebody opens every morning. Both are appended rather than merged into the
 * order above: the catalog's own cluster-and-alphabetical order is the order, and a favourite's
 * place is wherever the member dragged it.
 */
export function sidebarGroups(): readonly SidebarGroupView[] {
  const permitted = permittedDestinations();
  return DESTINATION_GROUPS.map((group) => {
    const visibleCanonical = permitted
      .filter(
        (destination) =>
          destination.group === group.id &&
          destination.footerPinned !== true &&
          isShown(destination),
      )
      .map((destination) => destination.id);
    const orderedIds = mergeGroupOrder(visibleCanonical, preference.current.order[group.id] ?? []);
    const registryRows = orderedIds
      .map((id) => destinationById(id))
      .filter((destination): destination is Destination => destination !== undefined);
    const destinations =
      group.id === "tools"
        ? [...registryRows, ...toolSidebarDestinations()]
        : group.id === "favorites"
          ? [...registryRows, ...favoriteDestinations()]
          : registryRows;
    return {
      id: group.id,
      label: group.label,
      destinations,
      nodes: foldIntoClusters(destinations),
    };
  }).filter((group) => group.destinations.length > 0);
}

export interface SidebarEditingGroupView {
  readonly id: DestinationGroup;
  readonly label: string;
  /** In the sidebar now — pinned + shown, in the member's reconciled order (draggable). */
  readonly shown: readonly Destination[];
  /** Hidden from the sidebar — offered in canonical order, one click to bring back. */
  readonly hidden: readonly Destination[];
}

/**
 * The Customize-mode render tree: per group, EVERY destination the member may see, split into the
 * two tiers the editor shows — the ones in the sidebar now (shown, member order) and the ones a
 * click would bring back (hidden, canonical order). Footer-pinned rows (Settings, Downloads,
 * Uploads) are excluded — the footer's utility tray owns them, so they are never hideable or
 * reorderable.
 *
 * Clusters are NOT drawn here: Customize is about which rows are in the rail and in what order, and
 * a fold is a reading convenience the member opens and closes as they work. Editing inside a fold
 * would mean opening four of them to find one row.
 *
 * THE TOOLS GROUP IS EXCLUDED WHOLE. What a member sees there is what they are permitted to run,
 * and access control has already answered that; an eye beside a tool would be a second answer to the
 * same question, and an inert one. FAVOURITES is included — a favourite is the member's own, so
 * dragging them into the order they want is exactly what this mode is for, and the star removes one.
 * This is the editor's superset of sidebarGroups(), which shows only the visible tier.
 */
export function sidebarEditingGroups(): readonly SidebarEditingGroupView[] {
  const permitted = permittedDestinations();
  return DESTINATION_GROUPS.filter((group) => group.id !== "tools")
    .map((group) => {
      const members = permitted.filter(
        (destination) => destination.group === group.id && destination.footerPinned !== true,
      );
      const shownCanonical = members
        .filter((destination) => isShown(destination))
        .map((destination) => destination.id);
      const orderedShownIds = mergeGroupOrder(
        shownCanonical,
        preference.current.order[group.id] ?? [],
      );
      const shown = orderedShownIds
        .map((id) => destinationById(id))
        .filter((destination): destination is Destination => destination !== undefined);
      // Canonical order for the bring-back tier — the members array is already canonical.
      const hidden = members.filter((destination) => !isShown(destination));
      return {
        id: group.id,
        label: group.label,
        shown: group.id === "favorites" ? [...shown, ...favoriteDestinations()] : shown,
        hidden,
      };
    })
    .filter((group) => group.shown.length + group.hidden.length > 0);
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

/**
 * Show or hide a row. A FAVOURITE is not a registry row and cannot be hidden — hiding one would
 * leave it saved and invisible, which is no state at all — so the gesture removes it instead, which
 * is what the star on its row means.
 */
export function setShown(id: string, next: boolean): void {
  const favoritePath = favoritePathFromRowId(id);
  if (favoritePath !== null) {
    if (!next) removeFavorite(favoritePath);
    return;
  }
  const destination = destinationById(id);
  if (destination === undefined || destination.pinned === true) return;
  const current = preference.current;
  // Store only departures from the registry default, so future default changes reach members who
  // never touched this row.
  let visibilityOverrides: Record<string, boolean>;
  if (next === destination.defaultShown) {
    const { [id]: dropped, ...rest } = current.visibilityOverrides;
    void dropped;
    visibilityOverrides = rest;
  } else {
    visibilityOverrides = { ...current.visibilityOverrides, [id]: next };
  }
  // Bringing a row back replays its one-time gilt-draw arrival: forgetting it from `known` lets the
  // shell catch it as a NEW ARRIVAL where reconciliation seats it, then re-acknowledge it. Hiding
  // never highlights (there is nothing to draw attention to).
  const known = next ? current.known.filter((knownId) => knownId !== id) : current.known;
  preference.set({ ...current, visibilityOverrides, known });
}

/**
 * Reorder within a group (Customize mode). The whole reconciled arrangement is folded into storage
 * on the first move, so subsequent merges are stable around it. Favourites keep their order in their
 * own store, which is the only place it exists.
 */
export function moveDestination(group: DestinationGroup, id: string, toIndex: number): void {
  if (id === FIXED_LEADING_ID) return;
  const favoritePath = favoritePathFromRowId(id);
  if (favoritePath !== null) {
    moveFavorite(favoritePath, toIndex);
    return;
  }
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

/** Whether a sub-menu is folded away. Same departures-not-state rule as a group's fold. */
export function isClusterCollapsed(cluster: string): boolean {
  return preference.current.collapsedClusters.includes(cluster);
}

export function setClusterCollapsed(cluster: string, next: boolean): void {
  if (isClusterCollapsed(cluster) === next) return;
  const collapsedClusters = next
    ? [...preference.current.collapsedClusters, cluster]
    : preference.current.collapsedClusters.filter((id) => id !== cluster);
  preference.set({ ...preference.current, collapsedClusters });
}

export function toggleClusterCollapsed(cluster: string): void {
  setClusterCollapsed(cluster, !isClusterCollapsed(cluster));
}

/** The hover-to-expand preference — read reactively; default off. */
export function expandSidebarOnHover(): boolean {
  return preference.current.expandOnHover;
}

export function setExpandSidebarOnHover(next: boolean): void {
  if (preference.current.expandOnHover === next) return;
  preference.set({ ...preference.current, expandOnHover: next });
}
