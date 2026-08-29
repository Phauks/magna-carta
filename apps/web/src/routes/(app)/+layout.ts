import { redirect } from "@sveltejs/kit";
import type { LayoutLoad } from "./$types";

// The (app) session guard. Every signed-in surface renders inside this group, so the gate lives at
// its layout: ask the bootstrap endpoint whether there is a session, and route an unauthenticated
// visitor to /login (carrying the attempted path as `next` so login can return them). A 401 is the
// only "not signed in" signal — a transport failure (no Worker behind a frontend-only `vp dev`) is
// deliberately NOT treated as unauthenticated, so the SPA still renders against a missing backend.
// Runs client-side (the app is `ssr = false`).
//
// A SESSION IS NOT THE SAME AS A PLACE TO BE. A person who has made an account and has not yet
// joined a firm is fully signed in and has no workspace: the bootstrap answers a null firm, and
// every firm-scoped read behind this layout would answer the reserved 404. So they go to /welcome,
// which is the one signed-in surface that renders without a firm. The attempted path is NOT carried
// — there is nothing to return to yet, and the screen they are being sent to is the thing standing
// between them and every path in this group.
export const load: LayoutLoad = async ({ fetch, url }) => {
  let response: Response;
  try {
    response = await fetch("/api/v1/me", { headers: { accept: "application/json" } });
  } catch {
    return {};
  }
  if (response.status === 401) {
    redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (response.ok) {
    // A body that will not parse is not a verdict about the session, so it falls through and the
    // shell renders — the same posture the transport failure above takes.
    const bootstrap = await response
      .json()
      .then((body: unknown) => body as { firm?: unknown })
      .catch(() => null);
    if (bootstrap !== null && bootstrap.firm === null) redirect(307, "/welcome");
  }
  return {};
};
