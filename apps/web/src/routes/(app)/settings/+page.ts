/* /settings lands on its first (and so far only) section rather than a 404 — the settings index
   page arrives when there is more than one section to index. */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/settings/appearance");
}
