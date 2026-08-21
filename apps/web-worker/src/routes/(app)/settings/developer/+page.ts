/* Developer settings exist only in development builds — the section is absent from the registry
   in production, and this guard makes the route itself 404 in-shell rather than render a page
   whose controls could never do anything. */
import { error } from "@sveltejs/kit";

export function load(): void {
  if (!import.meta.env.DEV) error(404, "Not Found");
}
