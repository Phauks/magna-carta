/*
 * Keeping a browser crash on the server, so the `client_…` Error ID its screen shows can be looked
 * up afterwards in System Status. Without this a crash reached no server at all and its ID resolved
 * to nothing.
 *
 * WHAT IS SENT IS A SHAPE, NEVER CONTENT: the ID, the SvelteKit route id (a template such as
 * "/(app)/meetings/[meetingId]", not the address with its record numbers), the error's kind, the
 * engine's own message for the kinds whose message names code rather than data, the first stack
 * frame, and the build. The server re-checks the message rule and scrubs what it keeps.
 *
 * Fire and forget. A crash screen must draw whether or not this lands, so nothing here is awaited
 * by the caller and nothing here throws. A signed-out crash is refused by the server (there is no
 * member to attribute it to), and that is fine: the ID still works for a report.
 *
 * Its own module, apart from ./crash.ts, because it reads the build identity, which a plain unit
 * test cannot import; ./crash.ts stays testable without the build's defines.
 */
import { clientErrorsRecord } from "@magna-carta/api-client";
import { buildIdentityLine } from "$lib/build-identity.ts";
import { crashFacts } from "./crash.ts";

/** Send the crash's facts. Never throws, never awaited by the screen. */
export function recordCrash(errorId: string, error: unknown, route: string): void {
  const facts = crashFacts(error);
  void clientErrorsRecord({
    body: {
      errorId,
      route: route.slice(0, 200),
      errorName: facts.errorName.slice(0, 60),
      ...(facts.message === undefined ? {} : { message: facts.message.slice(0, 200) }),
      ...(facts.location === undefined ? {} : { location: facts.location.slice(0, 160) }),
      build: buildIdentityLine().slice(0, 60),
    },
  }).catch(() => {
    // Nothing to do: the screen already shows the ID, and a report can still carry it.
  });
}
