/*
 * NavigationLayout — the one shape for a screen with a navigational column on the left and the
 * chosen thing's content on the right, and the one row that column's choices are drawn as.
 *
 * The layout is exported BOTH as the default and as `Root`. The default came first and every
 * consumer imports it that way; `Root` is the house namespace spelling, so a screen that wants
 * `import * as NavigationLayout` gets `NavigationLayout.Root` and `NavigationLayout.Row` from the
 * same entry. They are the same component, not two.
 *
 * The row is a PART of this entry rather than a component of its own because it only ever appears
 * inside this column: it is sized and coloured to sit in the navigation the layout draws, and a
 * row of this treatment anywhere else would be a different decision. The layout still imposes no
 * structure on what the navigation holds — the bands, the groups and the order are the consumer's
 * — so taking the row is a choice, never a requirement.
 *
 * The GROUP is the second such part: a heading that folds what it holds, in the one disclosure
 * grammar the sidebar settled (the heading is the control, the chevron says which way it goes).
 * Same offer, same terms — a column that needs no fold renders none.
 */
export { default } from "./navigation-layout.svelte";
export { default as Root } from "./navigation-layout.svelte";
export { default as Row } from "./navigation-layout-row.svelte";
export { default as Group } from "./navigation-layout-group.svelte";
export { default as NavigationLayout } from "./navigation-layout.svelte";
export { default as NavigationLayoutRow } from "./navigation-layout-row.svelte";
export { default as NavigationLayoutGroup } from "./navigation-layout-group.svelte";
export type { NavigationWidth } from "./navigation-width.ts";
