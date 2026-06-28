import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { UserId } from "@magna-carta/identifiers/types";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

// One audit row per support-grant lifecycle transition or session redemption. user_id is the requesting
// firm member (the consent anchor); the acting staff principal id rides in metadata. Metadata is ids +
// enums only — insertAuthAuditStatement runs the redaction guard.
export async function writeSupportAudit(
  controlDatabase: SqlDatabase,
  input: {
    readonly event: string;
    readonly requesterUserId: UserId;
    readonly metadata: Record<string, string>;
    readonly now: string;
  },
): Promise<void> {
  await insertAuthAuditStatement(controlDatabase, {
    id: newIdentifier("authAudit"),
    event: input.event,
    userId: input.requesterUserId,
    metadata: input.metadata,
    now: input.now,
  }).run();
}
