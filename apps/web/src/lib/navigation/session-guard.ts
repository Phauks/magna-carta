/*
 * The signed-in gate, shared by every route group that renders a signed-in surface.
 *
 * It lives here rather than in one group's layout because there is more than one group now: the
 * application's own surfaces render inside the App Shell, and a document opened in its own tab
 * renders inside a shell with no destination rail. They are different chrome over the same
 * session, and a second copy of this gate is how one of them quietly stops enforcing it.
 *
 * Ask the bootstrap endpoint whether there is a session, and route an unauthenticated visitor to
 * /login (carrying the attempted path as `next` so login can return them). A 401 is the only "not
 * signed in" signal — a transport failure (no Worker behind a frontend-only `vp dev`) is
 * deliberately NOT treated as unauthenticated, so the SPA still renders against a missing backend.
 *
 * Runs client-side (the app is `ssr = false`), and runs ON EVERY NAVIGATION inside its group,
 * because it reads `url` and SvelteKit re-runs a load whose url it used. That is correct — the
 * guard has to judge every address, not the first one — and it used to mean a fresh `/api/v1/me`
 * per navigation, which is a control-plane read, a firm Durable Object wake, a permissions join,
 * the channel and flags, the firm name and the membership state, paid again for an answer that had
 * not changed. The re-run stays; it now resolves against the cache, so the SECOND and later
 * navigations cost nothing. This read is also the app's session bootstrap: warming it at the
 * session-stable ceiling is what lets the 38 surfaces that each read the session for themselves
 * stop paying for it.
 *
 * A SESSION IS NOT THE SAME AS A PLACE TO BE. A person who has made an account and has not yet
 * joined a firm is fully signed in and has no workspace: the bootstrap answers a null firm, and
 * every firm-scoped read behind this gate would answer the reserved 404. So they go to /welcome,
 * which is the one signed-in surface that renders without a firm. The attempted path is NOT carried
 * — there is nothing to return to yet, and the screen they are being sent to is the thing standing
 * between them and every path behind this gate.
 *
 * NOR IS A FIRM THE SAME AS A WORKSPACE THAT WORKS. A firm is activated in the control plane — which
 * is what attaches the account to it — before the queued message mirroring that account into the
 * firm's OWN database as a member has landed. In between, the bootstrap answers a firm and no
 * permissions, and every screen behind this gate refuses for a reason that reads like an
 * administrator has to grant something. It is a wait, so it is waited out on the joining screen,
 * which reports that last step by name — and `stalled`, that same write having been given up on,
 * goes to the same place: a screen that says the step stopped is worth more than a workspace that
 * refuses everything without saying why. `unknown` is deliberately not counted, because a
 * membership read that did not answer is not a verdict, and bouncing a working member out of a
 * working workspace on one would be worse than the gap this closes.
 */
import { redirect } from "@sveltejs/kit";
import { meGetOptions } from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";

/**
 * The session, from the cache when it is warm and from the server when it is not.
 *
 * `ensureQueryData` rather than the `prefetchQuery` every screen read uses, because this one read IS
 * the decision: the guard cannot route a member it has not heard about, so it waits, and a refusal
 * has to reach the `catch` below rather than settling silently into the cache.
 */
function readSession() {
  return queryClient.ensureQueryData({ ...meGetOptions(), staleTime: SESSION_STABLE });
}

/**
 * Judge one address. Returns nothing and throws SvelteKit's redirect where the member belongs
 * somewhere else, which is how a layout load refuses a route.
 */
export async function guardSignedInSurface(url: URL): Promise<Record<string, never>> {
  let bootstrap: Awaited<ReturnType<typeof readSession>>;
  try {
    bootstrap = await readSession();
  } catch (error) {
    // 401 is the only "not signed in" signal. Anything else — a transport failure, a 500 — is not a
    // verdict about the session, so the shell renders rather than bouncing a signed-in member out
    // of the app over a read that did not answer.
    if (failureOf(error).problem?.status === 401) {
      redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    return {};
  }

  const membership = bootstrap.membership?.state;
  const stillJoining =
    bootstrap.firm === null || membership === "provisioning" || membership === "stalled";
  if (stillJoining) redirect(307, "/welcome");
  return {};
}
