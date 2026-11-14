/**
 * The two widths the navigation column can take. Both derive from the popover measure: the
 * column's content box is `size.popover` wide and the gutter each side is what differs —
 * `standard` (space-24 a side, the settings width) and `narrow` (space-16 a side, which lands on
 * the global sidebar's own width). `wide` is the record-aside measure with the narrow gutter, for a
 * rail whose rows carry a name and a line under it (the Magnus conversations). A closed set, so a consumer cannot invent a third width; a
 * third width is a third gutter in the recipe, never a length at a call site.
 */
export type NavigationWidth = "narrow" | "standard" | "wide";
