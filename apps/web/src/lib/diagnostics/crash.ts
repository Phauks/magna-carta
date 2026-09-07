/*
 * What every crash does before anything is shown: mint the handle, leave the breadcrumb, and — in
 * development only — write the one console line.
 *
 * Shared by the two places a crash is caught, so they cannot drift: the SvelteKit hook
 * (hooks.client.ts — a failure while a route loads) and the render boundary in the root layout
 * (render-boundary.svelte — a throw while a component was rendering, which SvelteKit itself never
 * catches: it escapes the app's start as an unhandled rejection and leaves the screen blank).
 */
import { record } from "./breadcrumbs.ts";
import { newClientErrorId } from "./client-error-id.ts";

/**
 * What a member is told when the app itself broke. Deliberately says nothing about the cause: an
 * exception message is written for whoever wrote the code, and pasting it onto a screen is how a
 * stack trace ends up in a screenshot in a client's inbox. The cause is in the trace block, which is
 * assembled from named fields rather than from whatever the throw happened to carry.
 */
export const CRASH_MESSAGE = "Something went wrong";

/**
 * The ordered remedy a whole-page crash ends on. Shared by the root +error.svelte and the render
 * boundary, which draw the same screen for the same class of failure.
 */
export const PAGE_CRASH_STEPS: readonly string[] = [
  "Reload: a brief interruption usually clears on the next attempt.",
  "Go home, and open the screen again from the navigation.",
  "If it keeps happening, report it with the Error ID above.",
];

/**
 * Mint the handle for a crash and record that it happened here. Returns the `client_…` Error ID
 * the screen quotes. Nothing is filed: a crash offers "Report a problem", it does not send one
 * (docs/conventions/error-logging.md — reporting is user-initiated).
 */
export function noteCrash(error: unknown, route: string): string {
  const errorId = newClientErrorId();
  record("failure", `crash ${errorId}`, route);
  // The one console line the app writes, and only in development: a developer at a dev server wants
  // the stack immediately, and a member's browser console is not a place we put anything.
  if (import.meta.env.DEV) console.error(`[${errorId}]`, error);
  return errorId;
}
