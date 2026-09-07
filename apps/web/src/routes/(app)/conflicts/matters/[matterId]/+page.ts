/*
 * A matter's conflicts standing moved INTO the matter, as its own section beside Intake (the
 * owner's ruling, 2026-09-07). This address served it while it stood outside the matter shell, and
 * survives as a redirect rather than a 404: the intake checklist, the firm's own check history and
 * anything a member bookmarked all pointed here, and a standing a firm cannot reach reads as a
 * matter nobody checked — which is a different fact, and a far more alarming one.
 */
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  redirect(308, `/matters/${encodeURIComponent(params.matterId)}/conflicts`);
};
