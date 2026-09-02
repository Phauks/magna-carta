/*
 * A row of fields is two or three columns from the small breakpoint up and one column below it.
 * Utilities rather than a recipe, because a breakpoint is the one thing the recipe layer cannot
 * express — a custom property cannot sit inside a media query — and the layout is nothing but
 * that breakpoint. Literal strings, as Tailwind's scanner needs.
 */
export type FieldRowColumns = 2 | 3;

const COLUMN_CLASSES: Record<FieldRowColumns, string> = {
  2: "grid gap-12 sm:grid-cols-2",
  3: "grid gap-12 sm:grid-cols-3",
};

export function fieldRowClasses(columns: FieldRowColumns): string {
  return COLUMN_CLASSES[columns];
}
