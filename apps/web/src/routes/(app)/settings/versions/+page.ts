import { redirect } from "@sveltejs/kit";

// Versions became System Status. The old address is kept so a bookmark, or a link pasted into a
// support thread before the rename, still lands on the page that replaced it.
export function load(): never {
  redirect(308, "/settings/system-status");
}
