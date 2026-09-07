/*
 * What every money section holds in common: the surface it renders inside, the toolbar that
 * surface draws, and the registry the toolbar's links come from.
 *
 * A ledger imports MoneySurface and declares its section; it never composes the toolbar, the
 * panes, the counts strip or the pane toggle for itself. The toolbar is exported for the surface's
 * own tests and galleries, not as a second way to build a money screen.
 */
export { default as MoneySurface } from "./money-surface.svelte";
export { default as MoneyToolbar } from "./money-toolbar.svelte";
export {
  MONEY_SURFACE_DENSITIES,
  MONEY_SURFACE_DENSITY_KEY,
  MONEY_SURFACE_LAYOUTS,
  MONEY_SURFACE_LAYOUT_KEY,
  billHref,
  isMoneySectionSlug,
  moneySectionHref,
  moneySections,
  moneySurfaceDensityPreference,
  moneySurfaceLayoutPreference,
  type MoneySectionSlug,
  type MoneySurfaceDensity,
  type MoneySurfaceLayout,
} from "./money-sections.ts";
