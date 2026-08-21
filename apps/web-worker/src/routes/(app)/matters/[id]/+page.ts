/*
 * The bare matter address has no page of its own — it lands on the overview section. Redirecting
 * (rather than rendering overview here) keeps one canonical URL per section, so the overview tab
 * and the matter root never split into two addresses for the same view.
 */
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  redirect(307, `/matters/${params.id}/overview`);
};
