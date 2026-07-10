/* The in-shell catch-all: an unknown path must 404 INSIDE the app chrome (the group's
   +error.svelte), never on the bare root error page — an error page with no sidebar strands the
   user (owner review 2026-07-02). */
import { error } from "@sveltejs/kit";

export function load(): never {
  error(404, "Not Found");
}
