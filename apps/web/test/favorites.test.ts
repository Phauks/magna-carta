/*
 * FAVOURITES — the member's own shortcuts, saved from any screen's header and rendered as the
 * rail's first group. Owner's direction, 2026-09-16.
 *
 * What is worth pinning is everything that is NOT the platform's: a favourite can be any address,
 * including one no registry declares (a matter, a review set, a section deep inside one); it is
 * identified by its pathname, so the same place narrowed two ways is one favourite; and it borrows
 * its glyph from the area it sits in rather than storing one, so nothing has to be kept in step.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  FAVORITE_LIMIT,
  addFavorite,
  favoriteDestinations,
  favoritePath,
  favoritePathFromRowId,
  favorites,
  isFavorite,
  moveFavorite,
  removeFavorite,
  toggleFavorite,
} from "../src/lib/navigation/favorites.svelte.ts";
import { setShown, sidebarGroups } from "../src/lib/navigation/sidebar-preferences.svelte.ts";
import { destinationById } from "../src/lib/navigation/destinations.ts";

function clear(): void {
  for (const favorite of [...favorites()]) removeFavorite(favorite.path);
}

beforeEach(clear);

describe("saving a page", () => {
  it("saves any address at all, registry row or not", () => {
    addFavorite("/matters/mc-104/fees", "Carrington v. Doyle");
    addFavorite("/whois-lookup", "WHOIS Lookup");
    expect(favorites().map((favorite) => favorite.path)).toEqual([
      "/matters/mc-104/fees",
      "/whois-lookup",
    ]);
    expect(isFavorite("/matters/mc-104/fees")).toBe(true);
  });

  it("keys a favourite by its pathname, so a query string is the same place", () => {
    expect(favoritePath("/matters?status=open")).toBe("/matters");
    expect(favoritePath("/matters/")).toBe("/matters");
    addFavorite("/matters?status=open", "Matters");
    expect(isFavorite("/matters")).toBe(true);
    expect(favorites()).toHaveLength(1);
  });

  it("renames in place rather than moving, when a saved page is saved again", () => {
    addFavorite("/matters/mc-104", "Carrington v Doyle");
    addFavorite("/time", "Time");
    addFavorite("/matters/mc-104", "Carrington v. Doyle Jr.");
    expect(favorites().map((favorite) => favorite.label)).toEqual([
      "Carrington v. Doyle Jr.",
      "Time",
    ]);
  });

  it("refuses a nameless favourite rather than saving a blank row", () => {
    addFavorite("/matters/mc-104", "   ");
    expect(favorites()).toHaveLength(0);
  });

  it("toggles off what it toggled on", () => {
    toggleFavorite("/time", "Time");
    expect(isFavorite("/time")).toBe(true);
    toggleFavorite("/time", "Time");
    expect(isFavorite("/time")).toBe(false);
  });

  it("drops the oldest at the ceiling, so the gesture never fails", () => {
    for (let index = 0; index < FAVORITE_LIMIT + 3; index += 1) {
      addFavorite(`/matters/mc-${index}`, `Matter ${index}`);
    }
    expect(favorites()).toHaveLength(FAVORITE_LIMIT);
    expect(isFavorite("/matters/mc-0")).toBe(false);
    expect(isFavorite(`/matters/mc-${FAVORITE_LIMIT + 2}`)).toBe(true);
  });
});

describe("the rows they render as", () => {
  it("borrows the glyph and description of the area the address sits in", () => {
    addFavorite("/matters/mc-104/fees", "Carrington v. Doyle");
    const row = favoriteDestinations()[0];
    expect(row?.icon).toBe(destinationById("matters")?.icon);
    expect(row?.group).toBe("favorites");
    expect(row?.pinned).toBe(true);
  });

  it("lights only on its own address, so two favourites in one area never both light", () => {
    addFavorite("/matters/mc-104", "Carrington v. Doyle");
    expect(favoriteDestinations()[0]?.exact).toBe(true);
  });

  it("wears no maturity badge for a favourite that is not a destination itself", () => {
    // A member who favourites one matter has favourited a matter, not an alpha surface.
    addFavorite("/matters/mc-104", "Carrington v. Doyle");
    expect(favoriteDestinations()[0]?.stage).toBeUndefined();
    clear();
    addFavorite("/matters", "Matters");
    expect(favoriteDestinations()[0]?.stage).toBe("alpha");
  });

  it("leads the rail as its own group once one exists", () => {
    addFavorite("/time", "Time");
    const groups = sidebarGroups();
    expect(groups[0]?.id).toBe("favorites");
    expect(groups[0]?.destinations.map((row) => row.href)).toEqual(["/time"]);
  });
});

describe("arranging them", () => {
  it("moves one within the group and clamps a drop past either end", () => {
    addFavorite("/time", "Time");
    addFavorite("/billing", "Billing");
    addFavorite("/costs", "Costs");
    moveFavorite("/costs", 0);
    expect(favorites().map((favorite) => favorite.path)).toEqual(["/costs", "/time", "/billing"]);
    moveFavorite("/costs", 99);
    expect(favorites().map((favorite) => favorite.path)).toEqual(["/time", "/billing", "/costs"]);
  });

  it("is removed by the sidebar's own control, because hiding a favourite is no state at all", () => {
    addFavorite("/time", "Time");
    const rowId = favoriteDestinations()[0]!.id;
    expect(favoritePathFromRowId(rowId)).toBe("/time");
    setShown(rowId, false);
    expect(isFavorite("/time")).toBe(false);
  });
});
