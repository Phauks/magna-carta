import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  TransferPassId,
  TransferRunId,
  TransferSourceFileId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MatterMappingRules } from "./matter-mapping.ts";
import {
  insertTransferPassStatement,
  type NewTransferPass,
  type TransferPassRow,
} from "./transfer-pass-statements.ts";
import {
  abandonTransferRunStatement,
  completeTransferRunStatement,
  insertTransferRunStatement,
  type NewTransferRun,
} from "./transfer-run-statements.ts";
import {
  insertTransferSourceFileStatement,
  type NewTransferSourceFile,
} from "./transfer-source-file-statements.ts";

// What a member's three acts on a transfer write: starting a run, giving it a file, and asking for
// a pass over a file. Each is the row itself and an audit row saying who did it, for the caller to
// commit in one batch. Asking for a pass also puts a message on the firm's outbox, because the pass
// is work in proportion to the file and runs on the queue, never on the request.
//
// The audit rows carry identifiers only. A run's label and a file's name are a person's words and
// stay on their own rows.

export const TRANSFER_RUN_STARTED_EVENT = "recordTransfer.run_started";
export const TRANSFER_SOURCE_FILE_REGISTERED_EVENT = "recordTransfer.source_file_registered";
export const TRANSFER_PASS_REQUESTED_EVENT = "recordTransfer.pass_requested";

export const TRANSFER_SOURCE_FILE_UPLOAD_STARTED_EVENT =
  "recordTransfer.source_file_upload_started";
export const TRANSFER_SOURCE_FILE_PART_RECEIVED_EVENT = "recordTransfer.source_file_part_received";
export const TRANSFER_FILE_MAPPING_SAVED_EVENT = "recordTransfer.file_mapping_saved";
export const TRANSFER_RUN_ACCEPTED_EVENT = "recordTransfer.run_accepted";
export const TRANSFER_RUN_ABANDONED_EVENT = "recordTransfer.run_abandoned";

// The outbox topic an accepted run rides. The payload is `{ transferRunId }`. Its consumer asks for
// the conflicts checks the loaders withheld while records were arriving.
export const TRANSFER_RUN_ACCEPTED_TOPIC = "recordTransfer.runAccepted";

export interface TransferRunAcceptedPayload {
  readonly transferRunId: TransferRunId;
}

// The outbox topic the per-firm queue's consumer owns. The payload is `{ transferPassId }`.
export const TRANSFER_PASS_REQUESTED_TOPIC = "recordTransfer.passRequested";

export interface TransferPassRequestedPayload {
  readonly transferPassId: TransferPassId;
}

interface Actor {
  readonly actorUserId: UserId;
  readonly now: string;
  readonly randomSource?: RandomSource;
}

function audit(
  database: SqlDatabase,
  actor: Actor,
  event: string,
  subjectId: string,
  metadata: Record<string, string>,
) {
  return insertAuditLogStatement(database, {
    id: newIdentifier("auditLog", actor.randomSource),
    event,
    actorUserId: actor.actorUserId,
    subjectId,
    metadata,
    now: actor.now,
  });
}

export function startTransferRunEffect(
  database: SqlDatabase,
  run: Omit<NewTransferRun, "startedBy">,
  actor: Actor,
): EffectWrite {
  return {
    statements: [
      insertTransferRunStatement(database, { ...run, startedBy: actor.actorUserId }, actor.now),
      audit(database, actor, TRANSFER_RUN_STARTED_EVENT, run.id, {
        sourceSystem: run.sourceSystem,
      }),
    ],
    outboxMessages: [],
  };
}

export function registerTransferSourceFileEffect(
  database: SqlDatabase,
  file: NewTransferSourceFile,
  actor: Actor,
): EffectWrite {
  return {
    statements: [
      insertTransferSourceFileStatement(database, file, actor.now),
      audit(database, actor, TRANSFER_SOURCE_FILE_REGISTERED_EVENT, file.id, {
        transferRunId: file.transferRunId,
        sourceKind: file.sourceKind,
      }),
    ],
    outboxMessages: [],
  };
}

export function requestTransferPassEffect(
  database: SqlDatabase,
  pass: Omit<NewTransferPass, "requestedBy">,
  actor: Actor,
): EffectWrite {
  const payload: TransferPassRequestedPayload = { transferPassId: pass.id };
  return {
    statements: [
      insertTransferPassStatement(database, { ...pass, requestedBy: actor.actorUserId }, actor.now),
      audit(database, actor, TRANSFER_PASS_REQUESTED_EVENT, pass.id, {
        transferRunId: pass.transferRunId,
        transferSourceFileId: pass.transferSourceFileId,
        recordKind: pass.recordKind,
      }),
    ],
    outboxMessages: [{ topic: TRANSFER_PASS_REQUESTED_TOPIC, payload: { ...payload } }],
  };
}

// A file given in pieces has no row until its last piece is in and the pieces are joined. These two
// audit rows are the only record of the steps before that: who began the upload, and each piece
// that arrived. They name the file's identifier and a piece's number, nothing of its content.
export function transferFileUploadStepEffect(
  database: SqlDatabase,
  step: {
    readonly fileId: TransferSourceFileId;
    readonly transferRunId: TransferRunId;
    readonly partNumber?: number;
  },
  actor: Actor,
): EffectWrite {
  return {
    statements: [
      step.partNumber === undefined
        ? audit(database, actor, TRANSFER_SOURCE_FILE_UPLOAD_STARTED_EVENT, step.fileId, {
            transferRunId: step.transferRunId,
          })
        : audit(database, actor, TRANSFER_SOURCE_FILE_PART_RECEIVED_EVENT, step.fileId, {
            transferRunId: step.transferRunId,
            partNumber: String(step.partNumber),
          }),
    ],
    outboxMessages: [],
  };
}

// Saving the mapping a person is working on writes one object beside the file and this audit row,
// which says who saved and for which file. The mapping itself is not in the row.
export function saveTransferFileMappingEffect(
  database: SqlDatabase,
  file: { readonly id: TransferSourceFileId; readonly transferRunId: TransferRunId },
  actor: Actor,
): EffectWrite {
  return {
    statements: [
      audit(database, actor, TRANSFER_FILE_MAPPING_SAVED_EVENT, file.id, {
        transferRunId: file.transferRunId,
      }),
    ],
    outboxMessages: [],
  };
}

// Accepting a run ends it as complete and ends its quiet period: one message says the run's records
// are the firm's records now. The caller has read the run and found it open; a second accept that
// raced past that read changes no row, and its message asks for checks already asked for, which the
// conflicts ledger takes as one request.
export function acceptTransferRunEffect(
  database: SqlDatabase,
  transferRunId: TransferRunId,
  actor: Actor,
): EffectWrite {
  const payload: TransferRunAcceptedPayload = { transferRunId };
  return {
    statements: [
      completeTransferRunStatement(database, transferRunId, actor.now),
      audit(database, actor, TRANSFER_RUN_ACCEPTED_EVENT, transferRunId, {}),
    ],
    outboxMessages: [{ topic: TRANSFER_RUN_ACCEPTED_TOPIC, payload: { ...payload } }],
  };
}

// Abandoning a run stops it and announces nothing. The records it brought in and their links stay:
// they are real, and "this run was stopped part way" is what a later reader needs to know.
export function abandonTransferRunEffect(
  database: SqlDatabase,
  transferRunId: TransferRunId,
  actor: Actor,
): EffectWrite {
  return {
    statements: [
      abandonTransferRunStatement(database, transferRunId, actor.now),
      audit(database, actor, TRANSFER_RUN_ABANDONED_EVENT, transferRunId, {}),
    ],
    outboxMessages: [],
  };
}

// The members and matter types a matter's rules name that this firm does not have. A rule that
// names one would stop the pass at the first row that used it, so the request is refused instead,
// with the identifiers that are wrong. A deactivated member still counts: a matter closed years
// ago may be the responsibility of somebody who has left.
export async function unknownMatterRuleReferences(
  database: SqlDatabase,
  rules: MatterMappingRules,
): Promise<{ readonly members: string[]; readonly matterTypes: string[] }> {
  const members = new Set<string>(Object.values(rules.responsibleMember.members));
  if (rules.responsibleMember.otherwise !== undefined) {
    members.add(rules.responsibleMember.otherwise);
  }
  const matterTypes = new Set<string>(Object.values(rules.matterType?.types ?? {}));
  const unknownMembers: string[] = [];
  for (const userId of members) {
    const row = await database
      .prepare("SELECT user_id FROM member WHERE user_id = ?1")
      .bind(userId)
      .first();
    if (row === null) unknownMembers.push(userId);
  }
  const unknownMatterTypes: string[] = [];
  for (const matterTypeId of matterTypes) {
    const row = await database
      .prepare("SELECT id FROM matter_type WHERE id = ?1")
      .bind(matterTypeId)
      .first();
    if (row === null) unknownMatterTypes.push(matterTypeId);
  }
  return { members: unknownMembers.sort(), matterTypes: unknownMatterTypes.sort() };
}

// How long after its start a pass with no ending is taken to have lost the job that held it. A
// queue consumer is stopped by the platform well inside this.
export const TRANSFER_PASS_STALLED_AFTER_MINUTES = 20;

export type TransferPassState = "requested" | "running" | "stalled" | "finished" | "failed";

export function transferPassStateOf(
  pass: Pick<TransferPassRow, "started_at" | "finished_at" | "failed_at">,
  now: string,
): TransferPassState {
  if (pass.finished_at !== null) return "finished";
  if (pass.failed_at !== null) return "failed";
  if (pass.started_at === null) return "requested";
  const elapsed = Date.parse(now) - Date.parse(pass.started_at);
  return elapsed > TRANSFER_PASS_STALLED_AFTER_MINUTES * 60_000 ? "stalled" : "running";
}
