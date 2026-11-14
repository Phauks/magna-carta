import { redirect } from "@sveltejs/kit";
import { meGetOptions } from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
import type { LayoutLoad } from "./$types";

// The account surface's session guard.
//
// It exists SEPARATELY from the (app) group's guard because /account is not in that group — it
// renders in the Secure Shell without workspace chrome — and because it asks a strictly smaller
// question. The (app) guard also decides whether somebody has a place to be: no firm, or a
// membership still provisioning, sends them to /welcome. None of that binds here. An account's
// own profile, credentials and signed-in devices belong to the PERSON, not to their firm, so
// somebody who has an account and has not yet joined a firm is entitled to every one of these
// pages — and the day they most need the signed-in-devices screen is not a day to send them
// somewhere else first.
//
// So the only thing this refuses is having no session at all: a 401 from the bootstrap endpoint
// goes to /login carrying the attempted path, so signing in lands back here. Like the (app) guard,
// a transport failure is deliberately NOT read as unauthenticated — the SPA still renders against
// a missing backend (a frontend-only `vp dev` with no Worker behind it), where each screen then
// reports its own inability to read rather than the shell claiming somebody is signed out.
//
// This became load-bearing when Active Sessions landed: while every account page was an inert
// seam, an anonymous visitor typing the URL saw a disabled form and nothing turned on the answer.
// A page that reads real session data has to know there is a session first, or its own failure
// state ends up standing in for "you are not signed in", which is a different sentence.
// Runs client-side (the app is `ssr = false`). The session is read through the same cached
// bootstrap the (app) guard uses, so moving between the account pages and the app costs no second
// read.
export const load: LayoutLoad = async ({ url }) => {
  try {
    await queryClient.ensureQueryData({ ...meGetOptions(), staleTime: SESSION_STABLE });
  } catch (error) {
    if (failureOf(error).problem?.status === 401) {
      redirect(307, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
  }
  return {};
};
