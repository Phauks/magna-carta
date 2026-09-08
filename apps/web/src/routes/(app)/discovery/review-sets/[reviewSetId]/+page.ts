/*
 * The workspace's bare address lands on its documents, which is what a person came for. The strip's
 * other entry, the loads, is where material gets in and is read afterwards.
 */
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  redirect(307, `/discovery/review-sets/${params.reviewSetId}/documents`);
};
