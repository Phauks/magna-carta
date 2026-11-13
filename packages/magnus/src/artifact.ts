import { guarded, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MagnusArtifactId,
  MagnusConversationId,
  MagnusTurnId,
  UserId,
} from "@magna-carta/identifiers/types";
import { artifactRestoredAudit, artifactWrittenAudit, type MagnusWriteContext } from "./audit.ts";
import {
  ARTIFACTS_WINDOW_MAX_BYTES,
  ARTIFACT_VERSION_MAX_BYTES,
  contentByteLength,
  cutToByteLength,
} from "./limits.ts";

// The documents Magnus writes in a conversation: a letter, a table, a timeline.
//
// Magnus writes one by putting it in its answer between `<document title="...">` and `</document>`
// (the system prompt says how). The consumer takes each such block out of the answer and keeps it
// here as a version of the conversation's document with that title: a new title is a new document,
// the same title again is its next version. So the answer a member reads holds Magnus's words and a
// card for the document, and the document's history is its versions, which are only ever added. A
// member putting back an earlier version adds one too.
//
// A document belongs to its conversation: it is read by whoever can read the conversation, sent back
// to the model as the conversation's own work, and erased with the conversation.

export const MAGNUS_ARTIFACT_TABLE = "magnus_artifact";
export const MAGNUS_ARTIFACT_VERSION_TABLE = "magnus_artifact_version";

// At most this many documents are kept from one answer, and a conversation lists at most this many.
export const DOCUMENTS_PER_ANSWER_MAX = 3;
export const ARTIFACTS_PER_CONVERSATION_MAX = 50;
export const ARTIFACT_TITLE_MAX_LENGTH = 200;
const VERSION_NOTE_MAX_LENGTH = 200;
// A conversation's whole history of versions, read for the pane. Bounded like every read here.
const ARTIFACT_VERSIONS_READ_MAX = 2000;

export const ARTIFACT_RESTORE_GUARD = "magnus.artifact.restore";

export interface WrittenDocument {
  readonly title: string;
  readonly note: string | null;
  readonly content: string;
}

export interface ExtractedDocuments {
  // The answer with each kept document taken out of it.
  readonly prose: string;
  readonly documents: readonly WrittenDocument[];
  // Documents left out: over the size cap, or past the per-answer count.
  readonly leftOut: number;
}

const DOCUMENT_BLOCK =
  /<document\s+title="([^"\n]{1,200})"(?:\s+note="([^"\n]{0,200})")?\s*>\n?([\s\S]*?)\n?<\/document>/g;

export const DOCUMENT_LEFT_OUT_NOTE =
  "[A document in this answer was too long to keep, or one too many, and was left out.]";

function unescapeAttribute(value: string): string {
  return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").trim();
}

// Takes the documents out of an answer. An unclosed block is left in the answer as text, because a
// document cut off mid-way is not a document anybody asked for.
export function extractDocuments(answer: string): ExtractedDocuments {
  const documents: WrittenDocument[] = [];
  let leftOut = 0;
  const prose = answer.replace(DOCUMENT_BLOCK, (_whole, title: string, note, content: string) => {
    const name = unescapeAttribute(title).slice(0, ARTIFACT_TITLE_MAX_LENGTH);
    const text = content.trim();
    if (
      name === "" ||
      text === "" ||
      documents.length >= DOCUMENTS_PER_ANSWER_MAX ||
      contentByteLength(text) > ARTIFACT_VERSION_MAX_BYTES
    ) {
      leftOut += 1;
      return `\n${DOCUMENT_LEFT_OUT_NOTE}\n`;
    }
    const described = typeof note === "string" ? unescapeAttribute(note) : "";
    documents.push({
      title: name,
      note: described === "" ? null : described.slice(0, VERSION_NOTE_MAX_LENGTH),
      content: text,
    });
    return "\n";
  });
  const words = prose.replace(/\n{3,}/g, "\n\n").trim();
  // An answer that was only a document still says what it did, so the transcript never shows an
  // empty answer above the document's card.
  const said =
    words !== "" ? words : documents.map((document) => `Wrote "${document.title}".`).join("\n");
  return { prose: said, documents, leftOut };
}

// The key a title is matched on, so "Notice of Breach" and "notice of breach " are one document.
export function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ArtifactVersionRow {
  readonly artifactId: MagnusArtifactId;
  readonly versionNumber: number;
  readonly note: string | null;
  readonly writtenByTurnId: MagnusTurnId | null;
  readonly memberUserId: UserId;
  readonly restoredFromVersion: number | null;
  readonly createdAt: string;
  readonly bytes: number;
}

export interface ArtifactRow {
  readonly id: MagnusArtifactId;
  readonly conversationId: MagnusConversationId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListedArtifact extends ArtifactRow {
  // Oldest first.
  readonly versions: readonly ArtifactVersionRow[];
}

export async function listArtifacts(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<readonly ListedArtifact[]> {
  const [artifacts, versions] = await Promise.all([
    database
      .prepare(
        `SELECT id, conversation_id AS conversationId, title, created_at AS createdAt, updated_at AS updatedAt FROM ${MAGNUS_ARTIFACT_TABLE} WHERE conversation_id = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2`,
      )
      .bind(conversationId, ARTIFACTS_PER_CONVERSATION_MAX)
      .all<ArtifactRow>(),
    database
      .prepare(
        `SELECT v.artifact_id AS artifactId, v.version_number AS versionNumber, v.note, v.written_by_turn_id AS writtenByTurnId, v.member_user_id AS memberUserId, v.restored_from_version AS restoredFromVersion, v.created_at AS createdAt, length(CAST(v.content AS BLOB)) AS bytes FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} v JOIN ${MAGNUS_ARTIFACT_TABLE} a ON a.id = v.artifact_id WHERE a.conversation_id = ?1 ORDER BY v.artifact_id, v.version_number LIMIT ?2`,
      )
      .bind(conversationId, ARTIFACT_VERSIONS_READ_MAX)
      .all<ArtifactVersionRow>(),
  ]);
  const byArtifact = new Map<string, ArtifactVersionRow[]>();
  for (const version of versions.results) {
    const list = byArtifact.get(version.artifactId) ?? [];
    list.push(version);
    byArtifact.set(version.artifactId, list);
  }
  return artifacts.results.map((artifact) => ({
    ...artifact,
    versions: byArtifact.get(artifact.id) ?? [],
  }));
}

export async function readArtifact(
  database: SqlDatabase,
  artifactId: MagnusArtifactId,
): Promise<ArtifactRow | undefined> {
  const row = await database
    .prepare(
      `SELECT id, conversation_id AS conversationId, title, created_at AS createdAt, updated_at AS updatedAt FROM ${MAGNUS_ARTIFACT_TABLE} WHERE id = ?1`,
    )
    .bind(artifactId)
    .first<ArtifactRow>();
  return row ?? undefined;
}

export async function readArtifactVersionContent(
  database: SqlDatabase,
  artifactId: MagnusArtifactId,
  versionNumber: number,
): Promise<string | undefined> {
  const row = await database
    .prepare(
      `SELECT content FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id = ?1 AND version_number = ?2`,
    )
    .bind(artifactId, versionNumber)
    .first<{ content: string }>();
  return row?.content;
}

// Each document's latest version, for the window: Magnus revises a document from what it is now.
export interface CurrentDocument {
  readonly id: MagnusArtifactId;
  readonly title: string;
  readonly versionNumber: number;
  readonly content: string;
}

export async function readCurrentDocuments(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): Promise<readonly CurrentDocument[]> {
  const { results } = await database
    .prepare(
      `SELECT a.id, a.title, v.version_number AS versionNumber, v.content FROM ${MAGNUS_ARTIFACT_TABLE} a JOIN ${MAGNUS_ARTIFACT_VERSION_TABLE} v ON v.artifact_id = a.id AND v.version_number = (SELECT MAX(version_number) FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id = a.id) WHERE a.conversation_id = ?1 ORDER BY a.updated_at DESC, a.id DESC LIMIT ?2`,
    )
    .bind(conversationId, ARTIFACTS_PER_CONVERSATION_MAX)
    .all<CurrentDocument>();
  return results;
}

function documentHeading(document: CurrentDocument): string {
  return `--- Document in this conversation: ${document.title} (version ${document.versionNumber}) ---`;
}
const DOCUMENT_CUT_MARK = "[The rest of this document did not fit and was not sent.]";

// Lays the conversation's documents out under their own budget, the most recently changed first. The
// first that does not fit is cut and marked and the rest are named only, so Magnus knows they exist.
export function layOutCurrentDocuments(documents: readonly CurrentDocument[]): string {
  const parts: string[] = [];
  let remaining = ARTIFACTS_WINDOW_MAX_BYTES;
  for (const document of documents) {
    if (remaining <= 0) {
      parts.push(`${documentHeading(document)}\n[Not sent: no room left in this request.]`);
      continue;
    }
    const bytes = contentByteLength(document.content);
    if (bytes <= remaining) {
      parts.push(`${documentHeading(document)}\n${document.content}`);
      remaining -= bytes;
      continue;
    }
    parts.push(
      `${documentHeading(document)}\n${cutToByteLength(document.content, remaining)}\n${DOCUMENT_CUT_MARK}`,
    );
    remaining = 0;
  }
  return parts.join("\n\n");
}

function insertArtifactStatement(
  database: SqlDatabase,
  input: {
    readonly id: MagnusArtifactId;
    readonly conversationId: MagnusConversationId;
    readonly title: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_ARTIFACT_TABLE} (id, conversation_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
    )
    .bind(input.id, input.conversationId, input.title, input.now);
}

function touchArtifactStatement(
  database: SqlDatabase,
  artifactId: MagnusArtifactId,
  now: string,
): SqlStatement {
  // fitness:unguarded-write — the version beside it in the same batch is what fails when the document is gone; this only moves its place in the list.
  return database
    .prepare(`UPDATE ${MAGNUS_ARTIFACT_TABLE} SET updated_at = ?2 WHERE id = ?1`)
    .bind(artifactId, now);
}

// The next version number is taken inside the INSERT, so two writers racing for one document fail
// on the primary key rather than both claiming the same number.
function insertNextVersionStatement(
  database: SqlDatabase,
  input: {
    readonly artifactId: MagnusArtifactId;
    readonly content: string;
    readonly note: string | null;
    readonly writtenByTurnId: MagnusTurnId;
    readonly memberUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MAGNUS_ARTIFACT_VERSION_TABLE} (artifact_id, version_number, content, note, written_by_turn_id, member_user_id, restored_from_version, created_at) VALUES (?1, COALESCE((SELECT MAX(version_number) FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id = ?1), 0) + 1, ?2, ?3, ?4, ?5, NULL, ?6)`,
    )
    .bind(
      input.artifactId,
      input.content,
      input.note,
      input.writtenByTurnId,
      input.memberUserId,
      input.now,
    );
}

// The documents of one answer as writes: each one's next version, and a new document for a title the
// conversation does not have yet. `existing` is the conversation's documents by title key, read just
// before; `newArtifactId` mints the handle for a new one.
export function writeDocuments(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly magnusTurnId: MagnusTurnId;
    readonly memberUserId: UserId;
    readonly documents: readonly WrittenDocument[];
    readonly existing: ReadonlyMap<string, MagnusArtifactId>;
    readonly newArtifactId: () => MagnusArtifactId;
  },
): SqlStatement[] {
  const now = context.clock.now();
  const statements: SqlStatement[] = [];
  const known = new Map(input.existing);
  for (const document of input.documents) {
    const key = titleKey(document.title);
    let artifactId = known.get(key);
    if (artifactId === undefined) {
      artifactId = input.newArtifactId();
      known.set(key, artifactId);
      statements.push(
        insertArtifactStatement(database, {
          id: artifactId,
          conversationId: input.conversationId,
          title: document.title,
          now,
        }),
      );
    } else {
      statements.push(touchArtifactStatement(database, artifactId, now));
    }
    statements.push(
      insertNextVersionStatement(database, {
        artifactId,
        content: document.content,
        note: document.note,
        writtenByTurnId: input.magnusTurnId,
        memberUserId: input.memberUserId,
        now,
      }),
      artifactWrittenAudit(database, context, {
        conversationId: input.conversationId,
        artifactId,
        magnusTurnId: input.magnusTurnId,
      }),
    );
  }
  return statements;
}

// Puts an earlier version back as the newest one. Nothing is overwritten: the versions in between
// stay, and the new version names the one it came from. Refused, by the guard, when that version
// does not exist.
export function restoreArtifactVersion(
  database: SqlDatabase,
  context: MagnusWriteContext,
  input: {
    readonly conversationId: MagnusConversationId;
    readonly artifactId: MagnusArtifactId;
    readonly versionNumber: number;
    readonly memberUserId: UserId;
  },
): EffectWrite {
  const now = context.clock.now();
  return {
    statements: [
      guarded(
        database
          .prepare(
            `INSERT INTO ${MAGNUS_ARTIFACT_VERSION_TABLE} (artifact_id, version_number, content, note, written_by_turn_id, member_user_id, restored_from_version, created_at) SELECT artifact_id, (SELECT MAX(version_number) FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id = ?1) + 1, content, ?3, NULL, ?4, version_number, ?5 FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id = ?1 AND version_number = ?2`,
          )
          .bind(
            input.artifactId,
            input.versionNumber,
            `Restored version ${input.versionNumber}`,
            input.memberUserId,
            now,
          ),
        ARTIFACT_RESTORE_GUARD,
      ),
      touchArtifactStatement(database, input.artifactId, now),
      artifactRestoredAudit(database, context, {
        conversationId: input.conversationId,
        artifactId: input.artifactId,
        restoredFromVersion: input.versionNumber,
      }),
    ],
    outboxMessages: [],
  };
}

// A deleted conversation takes its documents and every version of them with it.
export function deleteConversationArtifactsStatements(
  database: SqlDatabase,
  conversationId: MagnusConversationId,
): SqlStatement[] {
  return [
    database
      .prepare(
        `DELETE FROM ${MAGNUS_ARTIFACT_VERSION_TABLE} WHERE artifact_id IN (SELECT id FROM ${MAGNUS_ARTIFACT_TABLE} WHERE conversation_id = ?1)`,
      )
      .bind(conversationId),
    database
      .prepare(`DELETE FROM ${MAGNUS_ARTIFACT_TABLE} WHERE conversation_id = ?1`)
      .bind(conversationId),
  ];
}
