/* The root is an entrance, not a place: every destination lives at its own address (owner
   review 2026-07-02 — /matters has a path, so Home does too). */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/home");
}
