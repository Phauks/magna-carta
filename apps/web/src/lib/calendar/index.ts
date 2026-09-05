/*
 * The one calendar every surface embeds. A host writes one tag with a scope; the reads, the window
 * arithmetic, the view state and the window an entry opens in are all the component's own, which is
 * what lets tooling/lint-one-ui hold the line against a second calendar composed anywhere else.
 *
 * `MatterCalendarList` is the module's other door: a matter's record as two tables, walked to the
 * end rather than windowed. It owns its own reads for the same reason the grid does, so a matter
 * page embeds it with a matter and writes no calendar read of its own.
 */
export { default as CalendarView } from "./calendar-view.svelte";
export { default as MatterCalendarList } from "./matter-calendar-list.svelte";
export type { CalendarScope } from "./calendar-scope.ts";
export type { CalendarView as CalendarViewKind } from "./calendar-window.ts";
