// Hibernation-aware push progress for a job coordinator Durable Object.
//
// The point of this module is that a subscribed browser costs nothing while it waits. A coordinator
// that accepts a socket through `ctx.acceptWebSocket()` (rather than holding the server end in a
// class property) can be evicted from memory with its sockets still open: the runtime stops billing
// duration, and delivers the next message or close by re-constructing the object. That is why NOTHING
// here lives on the instance. Everything a pushed frame needs is read back from two places that
// survive eviction:
//
//   - `ctx.storage`, which the coordinator already uses for the job's state; and
//   - the per-socket ATTACHMENT (`serializeAttachment`/`deserializeAttachment`), which holds the
//     subscription context the session established at upgrade time.
//
// The attachment is what makes the signed URL on `ready` honest. The bucket a job's artifact is
// signed against is resolved from the SUBSCRIBER's session at upgrade time, exactly as the polling
// route resolves it per request, and is carried on the socket rather than re-derived inside the
// object from a queue message. A woken object therefore signs against the same seam the poll would
// have, with no ambient state to go stale. Storage caps the attachment at 2 KiB, which this shape is
// nowhere near.
//
// Class properties do not survive hibernation, so this helper is constructed per call. It is a
// closure over `ctx` and two functions and holds no state of its own — constructing one is free.
import {
  JOB_PROGRESS_PROTOCOL_VERSION,
  parseClientFrame,
  PING_FRAME,
  PONG_FRAME,
  refusedFrame,
  stateFrame,
} from "./job-progress-protocol.ts";

// The subscription context established at upgrade time and carried for the life of the socket.
// `protocolVersion` is stamped so a socket that survives a deploy can be recognised as speaking an
// older contract; `bucketName` is the firm bucket the subscriber's session resolved.
export interface JobProgressAttachment {
  readonly protocolVersion: number;
  readonly bucketName: string;
}

// Sent when the job reaches a state it will not leave. A terminal frame is always the last frame, so
// the object closes rather than holding a socket that will never carry anything again.
const TERMINAL_CLOSE_CODE = 1000;
const TERMINAL_CLOSE_REASON = "job settled";

// A socket whose attachment cannot be read is a subscription this build cannot serve — it predates a
// protocol change, or was accepted by an older class. Closing it makes the client reconnect (or fall
// back to polling) instead of receiving frames signed against a bucket nobody can name. The code is
// from the private-use range (3000-4999) because that is the only range an application may define; the
// registered 1xxx codes above 1011 are not ours to send.
const UNSERVICEABLE_CLOSE_CODE = 4000;
const UNSERVICEABLE_CLOSE_REASON = "reconnect required";

export function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
}

// The bucket the subscriber's session resolved, carried on the internal upgrade request the route
// makes to the object. It rides the URL rather than a header because the route BUILDS that URL from
// server-derived values — nothing a caller sent can reach it — whereas a header travels alongside
// whatever else the forwarded request carries.
const BUCKET_PARAMETER = "bucket";

export function subscribeRequestUrl(bucketName: string): string {
  return `https://job-progress.invalid/subscribe?${BUCKET_PARAMETER}=${encodeURIComponent(bucketName)}`;
}

// The whole request the route sends inward: built from scratch rather than by re-wrapping the
// caller's, so nothing the caller sent — cookie, headers, anything — travels on to the object. The
// object needs exactly two things, and both are stated here.
export function subscribeRequest(bucketName: string): Request {
  return new Request(subscribeRequestUrl(bucketName), { headers: { Upgrade: "websocket" } });
}

export function bucketNameFromSubscribeRequest(request: Request): string | null {
  const bucketName = new URL(request.url).searchParams.get(BUCKET_PARAMETER);
  return bucketName !== null && bucketName !== "" ? bucketName : null;
}

function attachmentOf(socket: WebSocket): JobProgressAttachment | null {
  const attachment = socket.deserializeAttachment() as JobProgressAttachment | null | undefined;
  if (attachment === null || attachment === undefined) return null;
  return typeof attachment.bucketName === "string" && attachment.bucketName !== ""
    ? attachment
    : null;
}

export interface JobProgressSocketsOptions<State> {
  // Resolves the state to push to ONE subscriber. Takes that subscriber's attachment so a signed URL
  // is minted against the bucket its own session resolved, never an ambient one.
  readonly stateFor: (attachment: JobProgressAttachment) => Promise<State>;
  // True when the job will not transition again. A terminal state is pushed and then the socket is
  // closed — the client already has everything the job will ever produce.
  readonly isTerminal: (state: State) => boolean;
}

export class JobProgressSockets<State> {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: JobProgressSocketsOptions<State>,
  ) {}

  // Accepts an upgrade and sends the current state immediately, so a subscriber never has to poll
  // once to learn where the job already is. Returns the 101 the route hands straight back.
  async accept(request: Request): Promise<Response> {
    const bucketName = bucketNameFromSubscribeRequest(request);
    if (bucketName === null) {
      return new Response("subscribe requires the resolved firm bucket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation, not `server.accept()`: the runtime owns the server end, so this object can be
    // evicted while the socket stays open and is re-constructed when a frame arrives.
    this.ctx.acceptWebSocket(server);

    const attachment: JobProgressAttachment = {
      protocolVersion: JOB_PROGRESS_PROTOCOL_VERSION,
      bucketName,
    };
    server.serializeAttachment(attachment);

    // Keepalives are answered by the runtime itself, so a heartbeat from an idle tab never wakes this
    // object (and never bills duration). Registered here rather than in the constructor because it
    // only means anything once a socket exists, and re-registering the same pair is a no-op.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));

    await this.push(server, attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pushes the current state to every subscriber. Called by the coordinator at each transition; a
  // no-op when nobody is listening, which is the common case and costs one array read.
  async broadcast(): Promise<void> {
    // One pass over the subscribers rather than one after another: each push costs an R2 head plus a
    // presign, and a job several people are watching should not pay those round trips in series.
    await Promise.all(
      this.ctx.getWebSockets().map(async (socket) => {
        const attachment = attachmentOf(socket);
        if (attachment === null) {
          socket.close(UNSERVICEABLE_CLOSE_CODE, UNSERVICEABLE_CLOSE_REASON);
          return;
        }
        await this.push(socket, attachment);
      }),
    );
  }

  // The hibernation message handler the coordinator forwards `webSocketMessage` to.
  async onMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const parsed = parseClientFrame(message);
    if ("refusal" in parsed) {
      socket.send(refusedFrame(parsed.refusal));
      return;
    }
    // A ping reaching here means the client did not send the byte-exact auto-response frame. Answer
    // it anyway — the contract is the frame, not the optimization.
    if (parsed.frame.type === "ping") {
      socket.send(PONG_FRAME);
      return;
    }
    const attachment = attachmentOf(socket);
    if (attachment === null) {
      socket.close(UNSERVICEABLE_CLOSE_CODE, UNSERVICEABLE_CLOSE_REASON);
      return;
    }
    await this.push(socket, attachment);
  }

  private async push(socket: WebSocket, attachment: JobProgressAttachment): Promise<void> {
    const state = await this.options.stateFor(attachment);
    socket.send(stateFrame(state));
    if (this.options.isTerminal(state)) {
      socket.close(TERMINAL_CLOSE_CODE, TERMINAL_CLOSE_REASON);
    }
  }
}
