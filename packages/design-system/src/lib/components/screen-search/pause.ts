/*
 * How long a "pause" search waits for typing to stop before the query leaves the machine.
 *
 * This is not an animation duration, so it is deliberately not a `--mc-duration-*` token: those
 * describe how long something takes to MOVE, and re-pointing them for a density or motion setting
 * must not change how many requests a firm's server receives. It lives here so every screen that
 * searches over the network waits the same length of time, and so a test can name the value rather
 * than sleeping a guess.
 *
 * 250 ms is the interval a fluent typist rarely crosses mid-word and a reader always crosses
 * between words, so one query goes out per thought rather than one per keystroke.
 */
export const SEARCH_PAUSE_MILLISECONDS = 250;
