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
//
// NOR IS A FIRM THE SAME AS A WORKSPACE THAT WORKS. A firm is activated in the control plane — which
// is what attaches the account to it — before the queued message mirroring that account into the
// firm's OWN database as a member has landed. In between, the bootstrap answers a firm and no
// permissions, and every screen in this group refuses for a reason that reads like an administrator
// has to grant something. It is a wait, so it is waited out on the joining screen, which reports
// that last step by name — and `stalled`, that same write having been given up on, goes to the same
// place: a screen that says the step stopped is worth more than a workspace that refuses everything
// without saying why. `unknown` is deliberately not counted, because a membership read that did not
// answer is not a verdict, and bouncing a working member out of a working workspace on one would be
// worse than the gap this closes.
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
      .then((body: unknown) => body as { firm?: unknown; membership?: { state?: unknown } })
      .catch(() => null);
    if (bootstrap !== null) {
      const membership = bootstrap.membership?.state;
      const stillJoining =
        bootstrap.firm === null || membership === "provisioning" || membership === "stalled";
      if (stillJoining) redirect(307, "/welcome");
    }
  }
  return {};
};
