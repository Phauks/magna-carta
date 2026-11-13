import { StoredSecretsDurableObject } from "../stored-secrets.ts";
import type { MagnusConversationId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { MagnusConversationSockets, type MagnusSubscriptionAttachment } from "./magnus-sockets.ts";
import {
  isTurnProgressTerminal,
  resolveConversationProgress,
  type TurnProgressState,
} from "./turn-progress.ts";

// The push side of one conversation, keyed `firmId:conversationId`.
//
// THIS OBJECT STORES NO CONVERSATION CONTENT. It has no `ctx.storage` writes at all — not the
// transcript, not a turn, not a cached answer. When it pushes, it reads the turn's state back out of
// the firm's own database through the firm-scoped data-access layer, using identifiers carried on the
// subscriber's socket attachment. That is what makes the retention posture enforceable rather than
// aspirational: exactly one copy of a transcript exists, in the firm's database, and this transport
// is a view of it. It is also precisely the constraint that made a conversation-persisting agent
// framework unusable here — such a framework writes history into the agent's own storage with no way
// to redirect it, which would put a second copy of privileged content somewhere the firm's erasure,
// backup, and export posture does not reach.
//
// The object is addressed by the SESSION firm id at the route, never a path value, so a firm can no
// more subscribe to another firm's conversation than it can poll one.
export class MagnusConversation extends StoredSecretsDurableObject {
  // Constructed per call: class properties do not survive hibernation, and this holds no state of its
  // own.
  private sockets(): MagnusConversationSockets<TurnProgressState> {
    return new MagnusConversationSockets(this.ctx, {
      stateFor: async (attachment: MagnusSubscriptionAttachment) =>
        resolveConversationProgress(
          firmDatabaseFor(this.env.FIRM_DATABASE, attachment.firmId),
          attachment.conversationId as MagnusConversationId,
        ),
      isTerminal: isTurnProgressTerminal,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint serves WebSocket subscriptions only", { status: 426 });
    }
    return this.sockets().accept(request);
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.sockets().onMessage(socket, message);
  }

  override webSocketClose(socket: WebSocket): void {
    // A fixed normal code rather than the peer's: 1005/1006 are reported to a close handler but are
    // not valid to send. Nothing else to unwind — a subscription is the socket and nothing else.
    socket.close(1000, "peer closed");
  }

  // Called by the queue consumer at every turn transition. It carries no state: the object re-reads
  // the turn from the firm database and pushes what it finds, so the frame a subscriber receives is
  // the same answer the poll endpoint would have given.
  async notifyTurnTransition(): Promise<void> {
    await this.sockets().broadcast();
  }
}
