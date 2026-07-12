/* /settings lands on the first section in the nav's canonical order (Theme, the user band's
   first entry) rather than a 404 — a settings index page arrives if one ever earns its keep. */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/settings/theme");
}
