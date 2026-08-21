// Hibernation-aware push for a Magnus conversation, over the shipped push-progress frame contract
// (../progress/job-progress-protocol.ts — the same frames, the same version, the same byte-exact
// keepalive pair, the same refusal labels).
//
// It is a SIBLING of ../progress/job-progress-sockets.ts rather than a reuse of it, and the reason is
// one line in that file: its subscription attachment carries the firm R2 bucket a signed artifact URL
// is minted against, and it CLOSES a socket whose attachment has no bucket. That check is a
// confidentiality guard for the two surfaces that hand out signed URLs, and relaxing it so a third
// surface with no artifact could share the class would weaken it for both. A conversation has no
// artifact to sign — its state is read back from the firm's own database — so it carries different
// context and validates it differently. The frames stay in the one home; only the attachment differs.
//
// Nothing about a subscription lives on the Durable Object instance. Class properties do not survive
// hibernation, so everything a pushed frame needs comes from the per-socket attachment, which does.
// And nothing about the CONVERSATION lives in the object's storage either: the object holds
// identifiers and reads the turn state back through the firm-scoped data-access layer every time it
// pushes, so exactly one copy of a transcript exists and it is in the firm's own database.
import {
  JOB_PROGRESS_PROTOCOL_VERSION,
  parseClientFrame,
  PING_FRAME,
  PONG_FRAME,
  refusedFrame,
  stateFrame,
} from "../progress/job-progress-protocol.ts";

// The subscription context established at upgrade time and carried for the life of the socket. Both
// values are SERVER-DERIVED at the route — the firm from the session, the conversation after the
// caller was authorized against it — so nothing a caller sent reaches the read this object performs.
export interface MagnusSubscriptionAttachment {
  readonly protocolVersion: number;
  readonly firmId: string;
  readonly conversationId: string;
}

const TERMINAL_CLOSE_CODE = 1000;
const TERMINAL_CLOSE_REASON = "turn settled";

// A socket whose attachment cannot be read is a subscription this build cannot serve — it predates a
// protocol change, or was accepted by an older class. Closing makes the client reconnect (or fall
// back to polling) rather than receive frames resolved against a firm nobody can name. The code is
// from the private-use range (3000-4999), the only range an application may define.
const UNSERVICEABLE_CLOSE_CODE = 4000;
const UNSERVICEABLE_CLOSE_REASON = "reconnect required";

const FIRM_PARAMETER = "firm";
const CONVERSATION_PARAMETER = "conversation";

export function magnusSubscribeRequestUrl(firmId: string, conversationId: string): string {
  return `https://magnus-conversation.invalid/subscribe?${FIRM_PARAMETER}=${encodeURIComponent(firmId)}&${CONVERSATION_PARAMETER}=${encodeURIComponent(conversationId)}`;
}

// The whole request the route sends inward: built from scratch rather than by re-wrapping the
// caller's, so no cookie and no caller-supplied header travels on to the object. The object needs
// exactly two values and both are stated here.
export function magnusSubscribeRequest(firmId: string, conversationId: string): Request {
  return new Request(magnusSubscribeRequestUrl(firmId, conversationId), {
    headers: { Upgrade: "websocket" },
  });
}

export function magnusSubscriptionFromRequest(
  request: Request,
): { readonly firmId: string; readonly conversationId: string } | null {
  const parameters = new URL(request.url).searchParams;
  const firmId = parameters.get(FIRM_PARAMETER);
  const conversationId = parameters.get(CONVERSATION_PARAMETER);
  if (firmId === null || firmId === "" || conversationId === null || conversationId === "") {
    return null;
  }
  return { firmId, conversationId };
}

function attachmentOf(socket: WebSocket): MagnusSubscriptionAttachment | null {
  const attachment = socket.deserializeAttachment() as MagnusSubscriptionAttachment | null;
  if (attachment === null || attachment === undefined) return null;
  return typeof attachment.firmId === "string" &&
    attachment.firmId !== "" &&
    typeof attachment.conversationId === "string" &&
    attachment.conversationId !== ""
    ? attachment
    : null;
}

export interface MagnusSocketsOptions<State> {
  // Resolves the state to push to ONE subscriber, from that subscriber's own attachment. The read
  // happens here rather than being cached anywhere, which is what keeps the object content-free.
  readonly stateFor: (attachment: MagnusSubscriptionAttachment) => Promise<State>;
  // True when the turn will not transition again — pushed once, then the socket closes.
  readonly isTerminal: (state: State) => boolean;
}

export class MagnusConversationSockets<State> {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly options: MagnusSocketsOptions<State>,
  ) {}

  async accept(request: Request): Promise<Response> {
    const subscription = magnusSubscriptionFromRequest(request);
    if (subscription === null) {
      return new Response("subscribe requires the resolved firm and conversation", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation, not `server.accept()`: the runtime owns the server end, so this object can be
    // evicted while the socket stays open and is re-constructed when a frame arrives. An idle
    // subscription therefore bills nothing, which matters on a surface a member leaves open.
    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      protocolVersion: JOB_PROGRESS_PROTOCOL_VERSION,
      firmId: subscription.firmId,
      conversationId: subscription.conversationId,
    } satisfies MagnusSubscriptionAttachment);

    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));

    await this.push(server, {
      protocolVersion: JOB_PROGRESS_PROTOCOL_VERSION,
      firmId: subscription.firmId,
      conversationId: subscription.conversationId,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Pushes the current state to every subscriber. A no-op when nobody is listening, which is the
  // common case and costs one array read.
  async broadcast(): Promise<void> {
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

  async onMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const parsed = parseClientFrame(message);
    if ("refusal" in parsed) {
      // The socket stays open: a bad control frame is not a reason to drop a subscription that is
      // otherwise working.
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

  private async push(socket: WebSocket, attachment: MagnusSubscriptionAttachment): Promise<void> {
    const state = await this.options.stateFor(attachment);
    socket.send(stateFrame(state));
    if (this.options.isTerminal(state)) {
      socket.close(TERMINAL_CLOSE_CODE, TERMINAL_CLOSE_REASON);
    }
  }
}
