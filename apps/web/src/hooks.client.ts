/*
 * The client's error boundary, and the breadcrumb trail that gives a report its context.
 *
 * WITHOUT THIS, A CRASH IS ANONYMOUS. SvelteKit's `+error.svelte` catches a failure while loading a
 * route, and the render boundary in the root layout ($lib/diagnostics/render-boundary.svelte) catches
 * a throw while a component renders; nothing caught a throw inside an event handler or a promise
 * nobody awaited. Those left a screen that silently stopped working, a console the member will
 * never open, no Error ID, and nothing to report. Every one of them now mints a handle and records
 * a breadcrumb, so even a failure the API never saw is something a person can quote.
 *
 * NOTHING IS FILED AUTOMATICALLY. A crash offers "Report a problem"; it does not send one. That
 * holds the strict default the diagnostics setting already defines, and keeps reporting
 * user-initiated as docs/conventions/error-logging.md specifies — the standing consent tier is a
 * setting a firm turns on, not a behaviour that arrives with a boundary.
 */
import type { HandleClientError } from "@sveltejs/kit";
import { record } from "$lib/diagnostics/breadcrumbs.ts";
import { CRASH_MESSAGE, crashSignature, noteCrash } from "$lib/diagnostics/crash.ts";
import { recordCrash } from "$lib/diagnostics/crash-record.ts";

export const handleError: HandleClientError = ({ error, event, status, message }) => {
  // A 404 is routing, not a crash: it has no handle to mint and nothing to report.
  if (status === 404) return { message };

  const errorId = noteCrash(error, event.url.pathname);
  recordCrash(errorId, error, event.route.id ?? event.url.pathname);

  return { message: CRASH_MESSAGE, errorId, cause: crashSignature(error) };
};

/*
 * The two failures SvelteKit's boundary never sees. `onerror` catches a throw that escaped an event
 * handler; `unhandledrejection` catches a promise nobody awaited — which in a Svelte app is most of
 * them, since every `void somePromise()` is one missing catch away from silence.
 *
 * Neither can replace the screen, because neither knows what was rendering. What they can do is
 * leave a breadcrumb, so the next report says a crash happened here at this time rather than
 * arriving with no explanation for why the member is upset.
 */
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    // The exception's KIND and where it was thrown, never its message. A thrown message is written
    // by whoever wrote the throw and can carry anything the code had in hand — a document name, a
    // party, a field value — and a breadcrumb has no business holding it (golden rule 4). The
    // filename and line say which code failed, which is what a report needs.
    // An engine's own message is the exception: crash.ts says which kinds, and why.
    const where = event.filename === "" ? "unknown" : `${event.filename}:${String(event.lineno)}`;
    record(
      "failure",
      event.error instanceof Error
        ? `uncaught ${crashSignature(event.error)}`
        : `uncaught Error at ${where}`,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    // Same rule: the rejection's kind, never its reason.
    const reason: unknown = event.reason;
    record("failure", `unhandled rejection: ${crashSignature(reason)}`);
  });
}
