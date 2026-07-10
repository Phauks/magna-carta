import { redirect } from "@sveltejs/kit";
import type { LayoutLoad } from "./$types";

// The (app) session guard. Every signed-in surface renders inside this group, so the gate lives at
// its layout: ask the bootstrap endpoint whether there is a session, and route an unauthenticated
// visitor to /login (carrying the attempted path as `next` so login can return them). A 401 is the
// only "not signed in" signal — a transport failure (no Worker behind a frontend-only `vp dev`) is
// deliberately NOT treated as unauthenticated, so the SPA still renders against a missing backend.
// Runs client-side (the app is `ssr = false`).
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
  return {};
};
