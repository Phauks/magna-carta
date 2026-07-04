/*
 * Per-member sidebar preferences — the STAR layer over the canonical destination registry
 * (destinations.ts). The registry stays the truth about what exists; this store holds only
 * what THIS member shows and in what per-group order.
 *
 * INVARIANT — STARS GOVERN THE SIDEBAR ONLY. Every destination stays reachable through the
 * command palette regardless of stars, and Customize mode reveals every destination for
 * re-adding: hiding must never remove capability — searching for a thing is wanting it.
 *
 * Storage shape (localStorage, per browser; cross-tab synced by the storage event, the
 * developer-preferences pattern):
 * - `starredOverrides` records only DEPARTURES from the registry's defaultStarred, so a new
 *   registry destination shipped with defaultStarred true arrives starred even for members
 *   with long-standing customizations — additions surface predictably.
 * - `order` is per group, and holds ONLY ids the member has actually arranged. RECONCILIATION
 *   RULE: a starred id absent from the stored order enters at its CANONICAL position relative
 *   to the member's arrangement (mergeGroupOrder below); ids gone from the registry drop
 *   silently on read.
 * - `known` is arrival bookkeeping: ids that have appeared in this member's sidebar before.
 *   A visible id not yet known is a NEW ARRIVAL — the shell gives it a one-time gilt-draw
 *   highlight so the eye catches where it landed, then acknowledges it into `known`.
 * - `expandOnHover` is a per-browser interaction preference (default off): when the rail rests
 *   collapsed, hovering it floats the rail open as an overlay over the canvas. It lives here,
 *   beside the other per-browser sidebar preferences, rather than in the theme-preference seam.
 */

import {
  DESTINATION_GROUPS,
  DESTINATIONS,
  type Destination,
  type DestinationGroup,
} from "./destinations.ts";
import { FIXED_LEADING_ID, mergeGroupOrder } from "./sidebar-order.ts";

const STORAGE_KEY = "mc-sidebar-preferences";

interface SidebarPreferencesValue {
  starredOverrides: Record<string, boolean>;
  order: Partial<Record<DestinationGroup, string[]>>;
  known: string[];
  expandOnHover: boolean;
}

const REGISTRY_IDS = new Set(DESTINATIONS.map((destination) => destination.id));

/** What a pristine sidebar shows — the registry's pinned + default-starred rows. */
function defaultVisibleIds(): string[] {
  return DESTINATIONS.filter(
    (destination) => destination.pinned === true || destination.defaultStarred,
  ).map((destination) => destination.id);
}

function emptyValue(): SidebarPreferencesValue {
  // `known` seeds to the default-visible set: a fresh sidebar is not a wall of arrivals — the
  // gilt highlight is for rows that land LATER (a star elsewhere, a new registry addition).
  return { starredOverrides: {}, order: {}, known: defaultVisibleIds(), expandOnHover: false };
}

/** Normalization on read: unknown ids (retired registry rows, hand edits) drop silently. */
function readStoredPreferences(): SidebarPreferencesValue {
  // The app is an SPA, but module init must not assume a browser (tests, prerender safety).
  if (typeof localStorage === "undefined") return emptyValue();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyValue();
    const parsed = JSON.parse(raw) as Partial<SidebarPreferencesValue> | null;
    const value = emptyValue();
    if (parsed?.starredOverrides !== null && typeof parsed?.starredOverrides === "object") {
      for (const [id, starred] of Object.entries(parsed.starredOverrides)) {
        if (REGISTRY_IDS.has(id) && typeof starred === "boolean") {
          value.starredOverrides[id] = starred;
        }
      }
    }
    if (parsed?.order !== null && typeof parsed?.order === "object") {
      for (const group of DESTINATION_GROUPS) {
        const stored = (parsed.order as Record<string, unknown>)[group.id];
        if (Array.isArray(stored)) {
          const ids = stored.filter(
            (id): id is string => typeof id === "string" && REGISTRY_IDS.has(id),
          );
          if (ids.length > 0) value.order[group.id] = ids;
        }
      }
    }
    if (Array.isArray(parsed?.known)) {
      value.known = parsed.known.filter(
        (id): id is string => typeof id === "string" && REGISTRY_IDS.has(id),
      );
    }
    if (typeof parsed?.expandOnHover === "boolean") {
      value.expandOnHover = parsed.expandOnHover;
    }
    return value;
  } catch {
    return emptyValue();
  }
}

function persist(value: SidebarPreferencesValue): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable; the live preference still works for the session.
  }
}

const preferences = $state<SidebarPreferencesValue>(readStoredPreferences());

/*
 * CROSS-TAB FOLLOW. "storage" fires in every OTHER same-origin tab when the key changes, so a
 * star or reorder in one tab lands in all of them. Last write wins; the re-read goes through
 * readStoredPreferences so the receiving tab re-normalizes. `event.key === null` means
 * `storage.clear()` — this key may have changed too.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = readStoredPreferences();
    preferences.starredOverrides = next.starredOverrides;
    preferences.order = next.order;
    preferences.known = next.known;
    preferences.expandOnHover = next.expandOnHover;
  });
}

function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((destination) => destination.id === id);
}

/** Pinned rows are always on; otherwise the member's override wins over the registry default. */
export function isStarred(destination: Destination): boolean {
  if (destination.pinned === true) return true;
  return preferences.starredOverrides[destination.id] ?? destination.defaultStarred;
}

export interface SidebarGroupView {
  readonly id: DestinationGroup;
  readonly label: string;
  readonly destinations: readonly Destination[];
}

/**
 * The sidebar's render tree: per group, the pinned + starred destinations in the member's
 * reconciled order. Footer-pinned rows (Settings) are excluded — the footer renders them.
 */
export function sidebarGroups(): readonly SidebarGroupView[] {
  return DESTINATION_GROUPS.map((group) => {
    const visibleCanonical = DESTINATIONS.filter(
      (destination) =>
        destination.group === group.id &&
        destination.footerPinned !== true &&
        isStarred(destination),
    ).map((destination) => destination.id);
    const orderedIds = mergeGroupOrder(visibleCanonical, preferences.order[group.id] ?? []);
    return {
      id: group.id,
      label: group.label,
      destinations: orderedIds
        .map((id) => destinationById(id))
        .filter((destination): destination is Destination => destination !== undefined),
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
 * The Customize-mode render tree: per group, EVERY destination split into the two tiers the
 * editor shows — the ones in the sidebar now (starred, member order) and the ones a click would
 * add (unstarred, canonical order). Footer-pinned rows (Settings) are excluded — the footer owns
 * them. This is the editor's superset of sidebarGroups(), which shows only the starred tier.
 */
export function sidebarEditingGroups(): readonly SidebarEditingGroupView[] {
  return DESTINATION_GROUPS.map((group) => {
    const members = DESTINATIONS.filter(
      (destination) => destination.group === group.id && destination.footerPinned !== true,
    );
    const starredCanonical = members
      .filter((destination) => isStarred(destination))
      .map((destination) => destination.id);
    const orderedStarredIds = mergeGroupOrder(starredCanonical, preferences.order[group.id] ?? []);
    const starred = orderedStarredIds
      .map((id) => destinationById(id))
      .filter((destination): destination is Destination => destination !== undefined);
    // Canonical order for the add-back tier — the members array is already canonical.
    const unstarred = members.filter((destination) => !isStarred(destination));
    return { id: group.id, label: group.label, starred, unstarred };
  }).filter((group) => group.starred.length + group.unstarred.length > 0);
}

/** A visible id the member's sidebar has never carried before — highlight once, then acknowledge. */
export function isNewArrival(id: string): boolean {
  return !preferences.known.includes(id);
}

/** Called by the shell once the arrival highlight has played; persists so it plays only once. */
export function acknowledgeArrival(id: string): void {
  if (preferences.known.includes(id)) return;
  preferences.known = [...preferences.known, id];
  persist({ ...preferences });
}

export function setStarred(id: string, next: boolean): void {
  const destination = destinationById(id);
  if (destination === undefined || destination.pinned === true) return;
  // Store only departures from the registry default, so future default changes reach members
  // who never touched this row.
  if (next === destination.defaultStarred) {
    const { [id]: dropped, ...rest } = preferences.starredOverrides;
    void dropped;
    preferences.starredOverrides = rest;
  } else {
    preferences.starredOverrides = { ...preferences.starredOverrides, [id]: next };
  }
  // Adding a row back replays its one-time gilt-draw arrival: forgetting it from `known` lets the
  // shell catch it as a NEW ARRIVAL where reconciliation seats it, then re-acknowledge it. Removing
  // never highlights (there is nothing to draw attention to).
  if (next) {
    preferences.known = preferences.known.filter((knownId) => knownId !== id);
  }
  persist({ ...preferences });
}

/**
 * Reorder within a group (Customize mode). The whole reconciled arrangement is folded into
 * storage on the first move, so subsequent merges are stable around it.
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
  preferences.order = { ...preferences.order, [group]: ids };
  persist({ ...preferences });
}

/** The hover-to-expand preference — read reactively; default off. */
export function expandSidebarOnHover(): boolean {
  return preferences.expandOnHover;
}

export function setExpandSidebarOnHover(next: boolean): void {
  if (preferences.expandOnHover === next) return;
  preferences.expandOnHover = next;
  persist({ ...preferences });
}
