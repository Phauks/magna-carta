import type { Bindings } from "../bindings.ts";
import type { MeetingCaptioner } from "./meeting-captioner.ts";

// WHERE A MEETING'S CAPTIONER IS FOUND, typed once for every caller in this directory and the sink
// route.
//
// The binding is declared in wrangler.jsonc beside the recorder's. It is OPTIONAL in code, on the
// recorder's precedent: a deployment that does not bind it cannot caption, and every caller treats its
// absence as "captions are not configured here" rather than as a fault. It is typed here, over the
// Worker's environment, rather than on `Bindings` itself, so that this directory's one new binding
// changes no file another stream is editing; folding it into `Bindings` beside `MEETING_RECORDER` is a
// one-line move whenever `app.ts` is next open for meetings.

interface CaptionerBindings {
  readonly MEETING_CAPTIONER?: DurableObjectNamespace<MeetingCaptioner>;
}

/** The deployment's captioner namespace, or undefined where it binds none. */
export function captionerNamespaceOf(
  env: Bindings,
): DurableObjectNamespace<MeetingCaptioner> | undefined {
  return (env as Bindings & CaptionerBindings).MEETING_CAPTIONER;
}

/** The one captioner for one meeting: addressed by the firm and the meeting, never by a caller's value. */
export function captionerFor(
  env: Bindings,
  firmId: string,
  meetingId: string,
): DurableObjectStub<MeetingCaptioner> | null {
  const namespace = captionerNamespaceOf(env);
  if (namespace === undefined) return null;
  return namespace.get(namespace.idFromName(`${firmId}:${meetingId}`));
}
