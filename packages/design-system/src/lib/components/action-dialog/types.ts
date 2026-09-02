/*
 * The ActionDialog contract. Everything a caller is allowed to hand the shell lives here, and
 * nothing in it names a kind of act: the shell renders a heading, a subtitle, a notice, a body and
 * an action bar, and it does not know or care what any of them contain. That is the whole point of
 * the type — a field that named one kind of act would be the first crack in the one-shell rule, and
 * the source scan in tooling/lint-one-ui exists to keep it out.
 *
 * It is the sibling of ./record-window's contract and is shaped the same way for the same reason: a
 * record is READ and CHANGED in a record window; an act is ASKED FOR here. Between them they are
 * every modal surface the product has.
 */

/**
 * What is being asked, and the only route to a different primitive, tone or dismissal verb.
 *
 * - `form` carries fields. Something was begun, so walking away is "Cancel", and the reader may put
 *   it down with a press outside as well as with Escape.
 * - `confirm` carries none. Nothing was begun, so declining is "Never mind", and only a deliberate
 *   answer closes it.
 * - `destructive` is a `confirm` whose commit takes something away, and says so in its colour.
 * - `reading` asks for nothing. It shows a thing and may offer a step IN PLACE, beside the fact the
 *   step changes; its action bar carries only the way out. The matter's status window is the case:
 *   somebody opens it to read where the paper file is kept as often as to close the matter, and a
 *   window whose bottom-right corner offers Close Matter puts the act they did not come for exactly
 *   where a hand goes by habit. A reading panel has no commit, and the props say so by type.
 *
 * Closed on purpose: a fifth kind is a reviewed change to this file, not a call site's
 * improvisation. What each one implies is resolved in ./action-dialog-model.ts.
 */
export type ActionDialogKind = "form" | "confirm" | "destructive" | "reading";

/** The kinds that ask for an act, and therefore carry a commit. */
export type ActingKind = Exclude<ActionDialogKind, "reading">;

/**
 * How a commit went.
 *
 * `committed` closes the panel; `refused` leaves it standing with whatever the caller has put in
 * the notice slot. The caller never touches `open` on the way out — returning the outcome is what
 * keeps the close to one path, which is what lets the guard cover every exit.
 */
export type ActionOutcome = "committed" | "refused";

/**
 * How wide a panel opens.
 *
 * A closed union rather than a class, because the widths across the panels this shell replaces
 * arrived as five different hand-written utilities for four intents. `record` is the width a record
 * window opens at, so a panel that CREATES a thing and the window that thing later opens in are the
 * same size, and the second does not read as a different place.
 */
export type ActionDialogWidth = "narrow" | "default" | "wide" | "record";
