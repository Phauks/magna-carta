/*
 * The deep-link target the federated read emits for a firm event (`/calendar/firm-events?entry=`).
 * It is the firm calendar with the agenda first, not a second screen: the entry opens in the same
 * window, on the same grid, and the reader is on the calendar when they close it.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({ openEntry: url.searchParams.get("entry") });
