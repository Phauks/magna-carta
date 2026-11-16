import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import {
  SIGNING_MEMBER_TURN_TOPIC,
  type SigningMemberTurnPayload,
} from "@magna-carta/signing/request";
import type { SigningRequestRow, SigningSignerRow } from "./statements.ts";

// Telling a colleague who signs in the app that a request is waiting on them. An outside signer is
// mailed a link (./signer-delivery.ts); a member is never mailed one, and hears through their
// notifications instead, raised from this outbox row.

/**
 * The outbox rows telling each colleague in the app that it is their turn. Committed in the batch
 * that marks them asked, so a notification exists exactly when the request is waiting on them.
 */
export function memberTurnMessages(
  request: SigningRequestRow,
  signers: readonly SigningSignerRow[],
): OutboxMessage[] {
  return signers.flatMap((signer) => {
    if (signer.attributionLevel !== "firm-authenticated" || signer.userId === null) return [];
    const payload: SigningMemberTurnPayload = {
      requestId: request.id,
      fileId: request.fileId,
      matterId: request.matterId,
      signerUserId: signer.userId,
    };
    return [{ topic: SIGNING_MEMBER_TURN_TOPIC, payload, aggregateKey: request.id }];
  });
}
