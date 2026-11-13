import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MagnusConversationId,
  MagnusArtifactId,
  MagnusFolderId,
  MagnusTurnId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TurnFailureLabel } from "./types.ts";

// The Magnus audit events. Metadata is identifiers, the disclosure version, the closed failure label,
// and the model and snapshot ids — nothing else, ever.
//
// That is enforced STRUCTURALLY rather than by care: every builder below takes a typed input whose
// fields are identifiers, numbers, and closed labels, so there is no field a turn's `content` could
// be passed in. A caller who wanted to log what somebody typed would have to change a type signature
// here, which is a visible act rather than an oversight at a call site.

export const MAGNUS_EVENTS = {
  conversationStarted: "magnus.conversation_started",
  turnSubmitted: "magnus.turn_submitted",
  turnCompleted: "magnus.turn_completed",
  turnFailed: "magnus.turn_failed",
  conversationRenamed: "magnus.conversation_renamed",
  conversationMoved: "magnus.conversation_moved",
  attachmentAdded: "magnus.attachment_added",
  attachmentRemoved: "magnus.attachment_removed",
  conversationDeleted: "magnus.conversation_deleted",
  conversationReadByAdministrator: "magnus.conversation_read_by_administrator",
  memberAcknowledged: "magnus.member_acknowledged",
  settingChanged: "magnus.setting_changed",
  folderCreated: "magnus.folder_created",
  folderRenamed: "magnus.folder_renamed",
  folderDeleted: "magnus.folder_deleted",
  conversationShelved: "magnus.conversation_shelved",
  turnRemoved: "magnus.turn_removed",
  permissionGranted: "magnus.permission_granted",
  permissionRevoked: "magnus.permission_revoked",
  artifactWritten: "magnus.artifact_written",
  artifactRestored: "magnus.artifact_restored",
} as const;

// What every Magnus write needs from its caller: the clock and the acting member (this package reads
// no ambient clock and trusts no ambient identity), plus an optional seeded source so fixtures mint
// byte-deterministic identifiers.
export interface MagnusWriteContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

function auditStatement(
  database: SqlDatabase,
  context: MagnusWriteContext,
  event: string,
  subjectId: string,
  metadata?: Record<string, string | number | null>,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: context.actorUserId,
    clock: context.clock,
    randomSource: context.randomSource,
    ...(metadata !== undefined && { metadata }),
  });
}

export function conversationStartedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly matterId: MatterId | null },
): SqlStatement {
  return auditStatement(
    database,
    context,
    MAGNUS_EVENTS.conversationStarted,
    input.conversationId,
    { matterId: input.matterId },
  );
}

export function turnSubmittedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly memberTurnId: MagnusTurnId;
    readonly magnusTurnId: MagnusTurnId;
    readonly disclosureVersion: number;
    // The member turn an edit replaces, when this submission is an edit. The audit row names the turn,
    // never what either version said.
    readonly replacesTurnId?: MagnusTurnId;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.turnSubmitted, input.conversationId, {
    memberTurnId: input.memberTurnId,
    magnusTurnId: input.magnusTurnId,
    disclosureVersion: input.disclosureVersion,
    ...(input.replacesTurnId !== undefined && { replacesTurnId: input.replacesTurnId }),
  });
}

// The author removed one of their messages and its answer. The pair is hidden, not erased (the text
// stays on the record until the whole conversation is deleted), and this row says which pair and who.
export function turnRemovedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly memberTurnId: MagnusTurnId;
    readonly magnusTurnId: MagnusTurnId | null;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.turnRemoved, input.conversationId, {
    memberTurnId: input.memberTurnId,
    magnusTurnId: input.magnusTurnId,
  });
}

// The provenance row: which model and which pinned snapshot produced this specific answer. That is
// what makes a year-old answer traceable to a model version; it is not, and cannot become, the answer
// itself.
export function turnCompletedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly magnusTurnId: MagnusTurnId;
    readonly modelId: string;
    readonly snapshotId: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.turnCompleted, input.magnusTurnId, {
    conversationId: input.conversationId,
    modelId: input.modelId,
    snapshotId: input.snapshotId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });
}

export function turnFailedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly magnusTurnId: MagnusTurnId;
    readonly failureLabel: TurnFailureLabel;
    readonly modelId: string | null;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.turnFailed, input.magnusTurnId, {
    conversationId: input.conversationId,
    failureLabel: input.failureLabel,
    modelId: input.modelId,
  });
}

// A rename records THAT the label changed, never the label itself. A member-typed title is free text
// about a matter and belongs in the row the member can delete, not in an append-only log that
// deleting the conversation does not reach.
export function conversationRenamedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly cleared: boolean },
): SqlStatement {
  return auditStatement(
    database,
    context,
    MAGNUS_EVENTS.conversationRenamed,
    input.conversationId,
    { cleared: input.cleared ? 1 : 0 },
  );
}

// Moving a conversation onto another matter, or off every matter, is an ACCESS decision as much as a
// filing one: which matter a transcript is kept on is what decides who may read it. So the row names
// both matters, and how many attachments went with the old one.
export function conversationMovedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly fromMatterId: MatterId | null;
    readonly toMatterId: MatterId | null;
    readonly detachedAttachments: number;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.conversationMoved, input.conversationId, {
    fromMatterId: input.fromMatterId,
    toMatterId: input.toMatterId,
    detachedAttachments: input.detachedAttachments,
  });
}

// An attachment is a REFERENCE to a matter's file, so the row names the file and nothing of it: which
// document a member put beside a question is a fact the firm keeps; the document's text is not.
export function attachmentAddedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly fileId: FileId },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.attachmentAdded, input.conversationId, {
    fileId: input.fileId,
  });
}

export function attachmentRemovedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly fileId: FileId },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.attachmentRemoved, input.conversationId, {
    fileId: input.fileId,
  });
}

// A deletion records that a conversation existed and was deleted. It never records what was in it —
// that is the whole point of being able to delete one.
export function conversationDeletedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly turnCount: number },
): SqlStatement {
  return auditStatement(
    database,
    context,
    MAGNUS_EVENTS.conversationDeleted,
    input.conversationId,
    { turnCount: input.turnCount },
  );
}

// A firm administrator reading somebody else's conversation is legitimate supervision, and it is
// exactly the kind of access that should leave a trace.
export function conversationReadByAdministratorAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly conversationId: MagnusConversationId; readonly authorUserId: UserId },
): SqlStatement {
  return auditStatement(
    database,
    context,
    MAGNUS_EVENTS.conversationReadByAdministrator,
    input.conversationId,
    { authorUserId: input.authorUserId },
  );
}

export function memberAcknowledgedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly userId: UserId; readonly disclosureVersion: number },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.memberAcknowledged, input.userId, {
    disclosureVersion: input.disclosureVersion,
  });
}

// The enablement flip. A firm needs to be able to answer "when did we turn this on, and who did it"
// without having thought to ask for it beforehand.
export function settingChangedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly settingKey: string; readonly newValue: string },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.settingChanged, input.settingKey, {
    newValue: input.newValue,
  });
}

// A member's folders arrange their own list. The rows say THAT a folder was made, renamed or removed,
// never its name: a folder's name is text the member typed about their own work, the same class as a
// conversation's title, and an append-only log is the one place deleting it could not reach.
export function folderCreatedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly folderId: MagnusFolderId },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.folderCreated, input.folderId);
}

export function folderRenamedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly folderId: MagnusFolderId },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.folderRenamed, input.folderId);
}

export function folderDeletedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: { readonly folderId: MagnusFolderId },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.folderDeleted, input.folderId);
}

// Where a member keeps a conversation: the folder (null is General) and whether it is pinned.
export function conversationShelvedAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly folderId: MagnusFolderId | null;
    readonly pinned: boolean;
  },
): SqlStatement {
  return auditStatement(
    database,
    context,
    MAGNUS_EVENTS.conversationShelved,
    input.conversationId,
    {
      folderId: input.folderId,
      pinned: input.pinned ? 1 : 0,
    },
  );
}

// A permission on what Magnus may read, turned on or off for one conversation. The permission's name
// is a closed label, never anything a member typed.
export function conversationPermissionAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly permission: string;
    readonly granted: boolean;
  },
): SqlStatement {
  return auditStatement(
    database,
    context,
    input.granted ? MAGNUS_EVENTS.permissionGranted : MAGNUS_EVENTS.permissionRevoked,
    input.conversationId,
    { permission: input.permission },
  );
}

// Magnus wrote a document, or a new version of one. Names the document and the version, never its
// words or its name.
export function artifactWrittenAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly artifactId: MagnusArtifactId;
    readonly magnusTurnId: MagnusTurnId;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.artifactWritten, input.conversationId, {
    artifactId: input.artifactId,
    magnusTurnId: input.magnusTurnId,
  });
}

// A member put an earlier version of a document back, as a new version.
export function artifactRestoredAudit(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly artifactId: MagnusArtifactId;
    readonly restoredFromVersion: number;
  },
): SqlStatement {
  return auditStatement(database, context, MAGNUS_EVENTS.artifactRestored, input.conversationId, {
    artifactId: input.artifactId,
    restoredFromVersion: input.restoredFromVersion,
  });
}
