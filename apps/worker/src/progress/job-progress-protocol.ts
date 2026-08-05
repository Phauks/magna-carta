// The push-progress wire contract: the frames a job-status WebSocket carries, in ONE home so the
// Durable Objects that push, the routes that upgrade, and any client that subscribes cannot drift on
// field names. The transport is the Durable Objects hibernation WebSocket API; this module is the
// payload half of it and deliberately holds no runtime state.
//
// The shape is chosen so the socket and the polling route are the SAME answer, not two answers that
// have to be kept in agreement by discipline: a `state` frame's `state` field is byte-identical to
// the body the corresponding poll endpoint returns (bundle: `{ status, url?, urls? }`; conversion:
// `{ status, url?, mediaType?, reason? }`). A client can therefore treat a pushed frame and a polled
// body interchangeably, and the polling route remains a complete fallback.
//
// Frames are JSON text. Binary frames are refused — there is nothing in this protocol that needs
// them, and refusing keeps the parse surface one function wide.

// Bumped when a frame's shape changes incompatibly. It rides on every `state` frame so a client that
// has been open across a deploy can tell it is talking to a protocol it does not know, rather than
// silently mis-reading a field. The server never negotiates: it states the version it speaks.
export const JOB_PROGRESS_PROTOCOL_VERSION = 1;

// The exact bytes of the keepalive pair. These are string literals rather than derived from a
// serializer because they are registered with the runtime's WebSocket auto-response, which matches
// the request frame BYTE-FOR-BYTE and answers it without waking a hibernating Durable Object. A
// client that pretty-prints its ping gets a normal (waking) round trip instead — correct, just not
// free — so a client SHOULD send exactly this string.
export const PING_FRAME = '{"type":"ping"}';
export const PONG_FRAME = '{"type":"pong"}';

// A control frame is tiny by construction; anything larger is not this protocol. The cap is applied
// before parsing so a subscriber cannot make the Durable Object parse arbitrary volume.
export const MAX_CLIENT_FRAME_BYTES = 256;

// client -> server.
//   ping   — keepalive; normally answered by the runtime's auto-response without waking the object.
//   resync — "send me the current state again", the frame a client sends after a reconnect rather
//            than falling back to the poll endpoint.
export type JobProgressClientFrame = { readonly type: "ping" } | { readonly type: "resync" };

// Why a frame was refused. A closed set: these are labels a client branches on, not prose.
export type JobProgressRefusal =
  | "frame-too-large"
  | "binary-unsupported"
  | "malformed-frame"
  | "unknown-frame";

// server -> client.
//   state    — the job's current state; sent once on subscribe and again on every transition.
//   pong     — the keepalive answer (normally produced by the runtime, not by this code).
//   refused  — the client frame was not understood. The socket stays open: a bad control frame is
//              not a reason to drop a subscription that is otherwise working.
export type JobProgressServerFrame<State> =
  | { readonly type: "state"; readonly protocolVersion: number; readonly state: State }
  | { readonly type: "pong" }
  | { readonly type: "refused"; readonly reason: JobProgressRefusal };

export function stateFrame(state: unknown): string {
  return JSON.stringify({
    type: "state",
    protocolVersion: JOB_PROGRESS_PROTOCOL_VERSION,
    state,
  } satisfies JobProgressServerFrame<unknown>);
}

export function refusedFrame(reason: JobProgressRefusal): string {
  return JSON.stringify({ type: "refused", reason } satisfies JobProgressServerFrame<never>);
}

// Parses a client frame, or returns the reason it was refused. Hand-written rather than schema-driven
// because the whole grammar is two nullary variants: a parser this small is easier to audit than the
// schema that would describe it, and it keeps a validation library off the socket path.
export function parseClientFrame(
  message: string | ArrayBuffer,
): { readonly frame: JobProgressClientFrame } | { readonly refusal: JobProgressRefusal } {
  if (typeof message !== "string") return { refusal: "binary-unsupported" };
  if (message.length > MAX_CLIENT_FRAME_BYTES) return { refusal: "frame-too-large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { refusal: "malformed-frame" };
  }
  if (parsed === null || typeof parsed !== "object") return { refusal: "malformed-frame" };
  const type = (parsed as { type?: unknown }).type;
  if (type === "ping") return { frame: { type: "ping" } };
  if (type === "resync") return { frame: { type: "resync" } };
  return { refusal: "unknown-frame" };
}
