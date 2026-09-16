/*
 * FAVOURITES — the member's own shortcuts, and the rail's first group.
 *
 * WHAT IT IS, AND WHAT IT IS NOT. Customize mode decides which of the destinations the PLATFORM
 * ships appear in their groups; it can only ever offer the rows this registry holds. A favourite is
 * the other thing entirely: any address at all, saved by the person standing on it. A matter they
 * are in every day, one tool out of nine, a client's record, a review set, a section deep inside a
 * matter. Nothing has to declare itself favouritable, which is the point — the platform cannot know
 * in advance which of ten thousand matters is the one somebody opens each morning.
 *
 * HOW ONE IS MADE. Every screen's header carries the star ($lib/screen/screen-header.svelte), so
 * the gesture is available on every page of the app without a single screen opting in: stand on the
 * page, press the star, and it is at the top of the rail. The star is the mark because a star means
 * this everywhere; Customize's show/hide gave the star up for an EYE on the owner's ruling of
 * 2026-09-16, precisely so the two stopped wearing one symbol for two meanings.
 *
 * WHAT IS STORED, AND WHY THAT. A path and the name the screen called itself. The PATH IS THE
 * IDENTITY — pathname only, no query string: a favourite is a place, and two addresses differing
 * only in how a list is narrowed are the same place. The LABEL is a snapshot of the screen's own
 * title at the moment it was saved, which is the honest thing to keep: a matter renamed after the
 * fact reads under its old name until the member opens it and saves it again. The alternative —
 * resolving every favourite's name live — means a read per favourite on every page load, for a
 * name the member chose by standing there.
 *
 * THE GLYPH IS NOT STORED. It is resolved from the registries at render time: the destination or
 * tool whose address the favourite sits under lends its icon, so a favourited matter wears the
 * Matters glyph and a favourited tool wears its own. Nothing to keep in sync, and a favourite whose
 * area is unrecognized falls back to the star it was made with.
 *
 * Per browser, like every other sidebar preference, on the shared persisted-preference primitive.
 */
import type { Component } from "svelte";
import Star from "@lucide/svelte/icons/star";
import { jsonPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { DESTINATIONS, type Destination } from "./destinations.ts";
import { toolSidebarDestinations } from "./tool-sidebar.ts";

const STORAGE_KEY = "mc-favorites";

/**
 * How many a member may keep. A rail group that outruns the rail is a group that has to be scrolled
 * past to reach the work, and the whole value of a shortcut is that it is above the fold. Reaching
 * the ceiling is not an error: the oldest favourite makes room, which is the behaviour of every
 * recents list and needs no dialog.
 */
export const FAVORITE_LIMIT = 24;

/** The prefix a favourite's synthesized row id carries, so it can never collide with a registry id. */
export const FAVORITE_ID_PREFIX = "favorite:";

export interface Favorite {
  /** The address, pathname only — the favourite's identity. */
  readonly path: string;
  /** What the screen called itself when the member saved it. */
  readonly label: string;
}

interface FavoritesValue {
  entries: Favorite[];
}

/** The address a favourite is keyed by: pathname only, no trailing slash (except the root). */
export function favoritePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const trimmed = withoutQuery.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Read-time validator: anything that is not a usable {path,label} pair drops. */
function normalize(parsed: unknown): FavoritesValue {
  if (parsed === null || typeof parsed !== "object") return { entries: [] };
  const stored = (parsed as Partial<FavoritesValue>).entries;
  if (!Array.isArray(stored)) return { entries: [] };
  const entries: Favorite[] = [];
  const seen = new Set<string>();
  for (const candidate of stored) {
    if (candidate === null || typeof candidate !== "object") continue;
    const { path, label } = candidate as Partial<Favorite>;
    if (typeof path !== "string" || !path.startsWith("/")) continue;
    if (typeof label !== "string" || label.trim() === "") continue;
    const normalized = favoritePath(path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ path: normalized, label: label.trim() });
    if (entries.length === FAVORITE_LIMIT) break;
  }
  return { entries };
}

const preference = createPersistedPreference(
  jsonPreference<FavoritesValue>(STORAGE_KEY, normalize),
);
preference.followAcrossTabs();

/** Every favourite, in the member's own order. Read reactively. */
export function favorites(): readonly Favorite[] {
  return preference.current.entries;
}

export function isFavorite(pathname: string): boolean {
  const path = favoritePath(pathname);
  return preference.current.entries.some((entry) => entry.path === path);
}

/**
 * Save this address under this name. Saving one already held REPLACES its label in place rather
 * than moving it — a screen whose title has changed updates where the member put it, which is the
 * only thing they could have meant by pressing the star on a page they had already saved.
 */
export function addFavorite(pathname: string, label: string): void {
  const path = favoritePath(pathname);
  const name = label.trim();
  if (name === "") return;
  const entries = preference.current.entries;
  const existing = entries.findIndex((entry) => entry.path === path);
  if (existing !== -1) {
    const updated = [...entries];
    updated[existing] = { path, label: name };
    preference.set({ entries: updated });
    return;
  }
  // At the ceiling the OLDEST goes, so the gesture always succeeds and never opens a dialog.
  const kept =
    entries.length >= FAVORITE_LIMIT ? entries.slice(entries.length - FAVORITE_LIMIT + 1) : entries;
  preference.set({ entries: [...kept, { path, label: name }] });
}

export function removeFavorite(pathname: string): void {
  const path = favoritePath(pathname);
  const entries = preference.current.entries.filter((entry) => entry.path !== path);
  if (entries.length === preference.current.entries.length) return;
  preference.set({ entries });
}

export function toggleFavorite(pathname: string, label: string): void {
  if (isFavorite(pathname)) removeFavorite(pathname);
  else addFavorite(pathname, label);
}

/** Reorder within the group (Customize mode). Out-of-range indices clamp rather than throw. */
export function moveFavorite(pathname: string, toIndex: number): void {
  const path = favoritePath(pathname);
  const entries = [...preference.current.entries];
  const fromIndex = entries.findIndex((entry) => entry.path === path);
  if (fromIndex === -1) return;
  const bounded = Math.max(0, Math.min(entries.length - 1, toIndex));
  if (bounded === fromIndex) return;
  const [moved] = entries.splice(fromIndex, 1);
  if (moved === undefined) return;
  entries.splice(bounded, 0, moved);
  preference.set({ entries });
}

/** The row id a favourite renders under — reversible, so a control can name the path it acts on. */
export function favoriteRowId(path: string): string {
  return `${FAVORITE_ID_PREFIX}${path}`;
}

/** The path behind a favourite row id, or null when the id is not one. */
export function favoritePathFromRowId(id: string): string | null {
  return id.startsWith(FAVORITE_ID_PREFIX) ? id.slice(FAVORITE_ID_PREFIX.length) : null;
}

/**
 * The destination a path sits under — the LONGEST matching href across the registry and the tool
 * rows, so /matters/abc/fees resolves to Matters rather than to whatever else happens to prefix it.
 * Null when nothing in the app claims the address.
 */
function areaFor(path: string): Destination | null {
  const candidates = [...DESTINATIONS, ...toolSidebarDestinations()].filter(
    (destination) => path === destination.href || path.startsWith(`${destination.href}/`),
  );
  return candidates.toSorted((left, right) => right.href.length - left.href.length)[0] ?? null;
}

/** A favourite's glyph: the area it lives in lends its own, else the star it was made with. */
export function favoriteIcon(path: string): Component {
  return areaFor(path)?.icon ?? Star;
}

/**
 * Favourites as sidebar rows. Synthesized rather than registry entries, because they are the
 * member's data and not the platform's — which is also why they are `pinned`: an eye beside a
 * favourite would offer to hide a row the member can simply un-favourite.
 *
 * A row carries the area's maturity stage only when the favourite IS that destination. A member who
 * favourites one matter has not favourited an alpha surface; they have favourited a matter, and a
 * badge there would be reporting on the platform in a group that is about their work.
 */
export function favoriteDestinations(): readonly Destination[] {
  return favorites().map((favorite): Destination => {
    const area = areaFor(favorite.path);
    const exact = area !== null && area.href === favorite.path;
    return Object.assign(
      {
        id: favoriteRowId(favorite.path),
        label: favorite.label,
        href: favorite.path,
        icon: favoriteIcon(favorite.path),
        description: area?.description ?? "A page you saved.",
        group: "favorites",
        shipped: true,
        pinned: true,
        defaultShown: true,
        exact: true,
      },
      exact && area.stage !== undefined ? { stage: area.stage } : {},
    );
  });
}
