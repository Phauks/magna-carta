/* The numbering screen was "Matter Numbering" while matters were the only sequence a firm could
   shape; it now lists every number the firm issues. A link written under the old name — a bookmark,
   a failure notice from an older build — lands on the one screen rather than a 404. */
import { redirect } from "@sveltejs/kit";

export function load(): never {
  redirect(307, "/settings/numbering");
}
