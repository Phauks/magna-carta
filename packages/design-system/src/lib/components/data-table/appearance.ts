/*
 * Table appearance — the View menu's presentation state. The consumer holds it (a rune) and feeds it
 * both to DataTable.ViewMenu (to toggle) and to the table element as data-attributes
 * (`data-zebra` / `data-dividers` / `data-row-density`), which the mc-table appearance recipes key
 * off. The attribute is data-ROW-density, deliberately NOT `data-density`: that name is the global
 * user density axis on <html>, and sharing it would make descendant selectors read a user's global
 * preference as a per-table option (and vice versa).
 */
export type TableDensity = "comfortable" | "compact";

export interface TableAppearance {
  /** Tint alternate body rows. */
  zebra: boolean;
  /** Draw vertical hairlines between columns. */
  dividers: boolean;
  /** Row density — compact trims the vertical padding + header height. */
  density: TableDensity;
}

/** The default appearance — comfortable, no stripes, no dividers. */
export function defaultTableAppearance(): TableAppearance {
  return { zebra: false, dividers: false, density: "comfortable" };
}

/** The data-attributes to spread onto <DataTable.Root> for the current appearance. */
export function appearanceAttributes(appearance: TableAppearance): {
  "data-zebra": "on" | undefined;
  "data-dividers": "on" | undefined;
  "data-row-density": TableDensity;
} {
  return {
    "data-zebra": appearance.zebra ? "on" : undefined,
    "data-dividers": appearance.dividers ? "on" : undefined,
    "data-row-density": appearance.density,
  };
}
