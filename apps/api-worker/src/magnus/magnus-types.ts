// The MAGNUS queue message. Identifiers only — the member's words stay in the turn row the consumer
// reads back through the firm-scoped data-access layer, so nothing privileged rides a queue payload,
// a dead-letter record, or an outbox row.
export interface MagnusTurnJob {
  readonly firmId: string;
  readonly conversationId: string;
  readonly magnusTurnId: string;
  // The outbox row's own identifier, carried so the per-run dedup key is stable across a redelivery
  // of the same submission.
  readonly outboxId: string;
}
