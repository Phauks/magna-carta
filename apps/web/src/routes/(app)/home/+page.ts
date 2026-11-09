/*
 * Home's reads, started where the hover preload can reach them.
 *
 * The Today card renders from the shared calendar context — the session, the firm's event types,
 * roster, Locations, resources, calendar settings and matters. Started from the component, those
 * reads could not begin until Home's code had been fetched, parsed and mounted; started here, they
 * begin when the pointer settles on a link to Home (`data-sveltekit-preload-data="hover"`,
 * src/app.html), in parallel with the code, and the card usually opens populated.
 *
 * Nothing is awaited and nothing is returned. The context is read at most once and shared, so the
 * component's own `load` joins this read rather than starting a second, and a read that fails
 * settles in the context for the card to render as its own failure notice — never an error page
 * over the whole screen, which awaiting here would produce.
 */
import { calendarContext } from "$lib/calendar/calendar-context.svelte.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ fetch }) => {
  void calendarContext.load(fetch);
};
