/* /account lands on the first section in the rail's canonical order (Profile) rather than a
   404 — an account index page arrives if one ever earns its keep. Mirrors /settings. */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/account/profile");
}
