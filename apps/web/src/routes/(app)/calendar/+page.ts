/*
 * The firm calendar. The address's `entry` is the deep link the federated read emits for a matter
 * event; the screen opens that entry's window on arrival. View, date and scope are read by the
 * component itself, because it is the component that mirrors them back.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({ openEntry: url.searchParams.get("entry") });
