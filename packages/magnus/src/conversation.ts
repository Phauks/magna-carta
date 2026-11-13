import { deleteConversationArtifactsStatements } from "./artifact.ts";
import { deleteConversationPermissionsStatement } from "./permissions.ts";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  MagnusConversationId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  attachmentAddedAudit,
  attachmentRemovedAudit,
  conversationDeletedAudit,
  conversationMovedAudit,
  conversationRenamedAudit,
  conversationStartedAudit,
  type MagnusWriteContext,
} from "./audit.ts";
import {
  archiveConversationStatement,
  deleteAttachmentStatement,
  deleteConversationAttachmentsStatement,
  deleteConversationTurnsStatement,
  insertAttachmentStatement,
  insertConversationStatement,
  markConversationDeletedStatement,
  moveConversationStatement,
  renameConversationStatement,
} from "./statements.ts";
import { deleteConversationShelvesStatement } from "./shelf.ts";

// Conversation lifecycle as statement compositions. Every function here is pure: it reads no clock,
// mints no identifier without the injected random source, calls nothing external, and returns an
// EffectWrite for the caller to commit atomically. A business outcome is a returned value, never a
// throw.

// A member-supplied title only. A model-generated one would be a model call over privileged content
// producing a second copy of it in a column that surfaces in every list — refused. A conversation
// with no title displays by its start instant.
export const CONVERSATION_TITLE_MAX_LENGTH = 200;

export interface StartConversationInput {
  readonly title: string | null;
  readonly createdBy: UserId;
  // Scopes the RECORD, not the prompt. Linking a conversation to a matter puts none of that matter's
  // content into any request; it answers "which matter's file does this transcript belong to".
  readonly matterId: MatterId | null;
}

export interface StartedConversation {
  readonly conversationId: MagnusConversationId;
  readonly effect: EffectWrite;
}

export function startConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: StartConversationInput,
): StartedConversation {
  const conversationId = newIdentifier("magnusConversation", context.randomSource);
  const now = context.clock.now();
  return {
    conversationId,
    effect: {
      statements: [
        insertConversationStatement(database, {
          id: conversationId,
          title: input.title,
          createdBy: input.createdBy,
          matterId: input.matterId,
          createdAt: now,
        }),
        conversationStartedAudit(database, context, {
          conversationId,
          matterId: input.matterId,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// A rename is audited like every other mutation — the platform admits no unaudited write — but the
// audit row records only THAT the label changed and whether it was cleared. A member-typed title is
// free text about a matter, and putting it in an append-only log would put a copy of it somewhere
// deleting the conversation cannot reach.
export function renameConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly title: string | null },
): EffectWrite {
  return {
    statements: [
      guarded(
        renameConversationStatement(database, {
          id: input.conversationId,
          title: input.title,
          now: context.clock.now(),
        }),
        "conversation.rename",
      ),
      conversationRenamedAudit(database, context, {
        conversationId: input.conversationId,
        cleared: input.title === null,
      }),
    ],
    outboxMessages: [],
  };
}

// Moving a conversation onto another matter, or off every matter. The matter a transcript is kept
// on is what decides who may read it, so this is an ACCESS decision as much as a filing one, and the
// audit row names both matters. The attachments go: each is one of the OLD matter's files, and a
// conversation kept elsewhere has no claim on it.
export function moveConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly fromMatterId: MatterId | null;
    readonly toMatterId: MatterId | null;
    readonly attachmentCount: number;
  },
): EffectWrite {
  return {
    statements: [
      guarded(
        moveConversationStatement(database, {
          id: input.conversationId,
          matterId: input.toMatterId,
          now: context.clock.now(),
        }),
        "conversation.move",
      ),
      deleteConversationAttachmentsStatement(database, input.conversationId),
      conversationMovedAudit(database, context, {
        conversationId: input.conversationId,
        fromMatterId: input.fromMatterId,
        toMatterId: input.toMatterId,
        detachedAttachments: input.attachmentCount,
      }),
    ],
    outboxMessages: [],
  };
}

// Attaching a matter's file by reference. The row copies nothing of the file; the caller has already
// checked that the file is one of the conversation's own matter's.
export function attachConversationFile(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly fileId: FileId },
): EffectWrite {
  return {
    statements: [
      insertAttachmentStatement(database, {
        conversationId: input.conversationId,
        fileId: input.fileId,
        attachedAt: context.clock.now(),
      }),
      attachmentAddedAudit(database, context, input),
    ],
    outboxMessages: [],
  };
}

export function detachConversationFile(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly fileId: FileId },
): EffectWrite {
  return {
    statements: [
      deleteAttachmentStatement(database, input),
      attachmentRemovedAudit(database, context, input),
    ],
    outboxMessages: [],
  };
}

export function archiveConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId },
): EffectWrite {
  return {
    statements: [
      guarded(
        archiveConversationStatement(database, {
          id: input.conversationId,
          now: context.clock.now(),
        }),
        "conversation.archive",
      ),
    ],
    outboxMessages: [],
  };
}

// Deletion removes every turn and leaves the conversation as a tombstone. It is the erasure
// instrument for the free text inside turns, which no structured registry can reach: the residue is
// removed wholesale rather than column by column.
export function deleteConversation(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly turnCount: number },
): EffectWrite {
  const now = context.clock.now();
  return {
    statements: [
      deleteConversationTurnsStatement(database, input.conversationId),
      deleteConversationAttachmentsStatement(database, input.conversationId),
      deleteConversationShelvesStatement(database, input.conversationId),
      deleteConversationPermissionsStatement(database, input.conversationId),
      ...deleteConversationArtifactsStatements(database, input.conversationId),
      markConversationDeletedStatement(database, { id: input.conversationId, now }),
      conversationDeletedAudit(database, context, {
        conversationId: input.conversationId,
        turnCount: input.turnCount,
      }),
    ],
    outboxMessages: [],
  };
}
