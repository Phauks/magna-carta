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
  record("failure", `crash ${errorId}: ${crashSignature(error)}`, route);
  // The one console line the app writes, and only in development: a developer at a dev server wants
  // the stack immediately, and a member's browser console is not a place we put anything.
  if (import.meta.env.DEV) console.error(`[${errorId}]`, error);
  return errorId;
}

/**
 * The engine's own kinds of failure, whose messages the JavaScript engine writes rather than our
 * code: "Cannot read properties of null (reading 'participantId')", "x is not a function",
 * "Invalid time value". They name code (a property, a variable), never what the code was holding,
 * so they are the one message a breadcrumb may carry, and they are what turns an Error ID into a
 * line a developer can find. A SyntaxError is left out: JSON.parse quotes the text it failed on.
 */
const ENGINE_KINDS: ReadonlySet<string> = new Set(["TypeError", "ReferenceError", "RangeError"]);
/** The longest engine message carried, so one pathological message cannot fill the ring. */
const ENGINE_MESSAGE_LIMIT = 160;

/**
 * What a crash was and where it was thrown, in one line for the breadcrumb ring (and so for the
 * trace a member copies and the report they send): the kind, the engine's message where the engine
 * wrote it, and the first frame of the stack as file, line and column. Never a message our own code
 * or a library wrote, for the reason in hooks.client.ts: those can carry what the code had in hand.
 */
export function crashSignature(error: unknown): string {
  if (!(error instanceof Error)) return `thrown ${typeof error}`;
  const kind = error.name === "" ? "Error" : error.name;
  const message =
    ENGINE_KINDS.has(kind) && error.message !== ""
      ? `: ${error.message.slice(0, ENGINE_MESSAGE_LIMIT)}`
      : "";
  const where = firstFrame(error.stack);
  return `${kind}${message}${where === null ? "" : ` at ${where}`}`;
}

/** The first stack frame as `file:line:column`, the file without its path or query. */
function firstFrame(stack: string | undefined): string | null {
  if (stack === undefined) return null;
  const match = /([^/\s()]+?\.(?:js|ts|svelte|mjs))(?:\?[^:\s)]*)?:(\d+):(\d+)/u.exec(stack);
  if (match === null) return null;
  return `${match[1] ?? ""}:${match[2] ?? ""}:${match[3] ?? ""}`;
}
