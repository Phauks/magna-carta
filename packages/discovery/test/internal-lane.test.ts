import { describe, expect, it } from "vitest";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { EmailMessageId, FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  assertSelectionMatchesMatter,
  assertSelectionSize,
  assertVersionsAreClean,
  selectAttachmentsForMessagesStatement,
  selectCurrentVersionsForFilesStatement,
  selectFiledMessagesStatement,
  type ResolvedFileVersion,
} from "../src/internal-lane.ts";
import { MAX_SELECTION_SIZE } from "../src/limits.ts";
import { DiscoveryValidationError } from "../src/validation.ts";

// A database that records the SQL it was handed and executes nothing. The statement builders are
// pure string composition, so this is all a builder test needs.
function recordingDatabase(): { database: SqlDatabase; lastSql: () => string } {
  let sql = "";
  const statement: SqlStatement = {
    bind: () => statement,
    run: async () => ({ meta: { changes: 0 } }),
    all: async () => ({ results: [] }),
    first: async () => null,
  };
  return {
    database: {
      prepare(text: string) {
        sql = text;
        return statement;
      },
    },
    lastSql: () => sql,
  };
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (caught) {
    if (caught instanceof DiscoveryValidationError) return caught.code;
    throw caught;
  }
  throw new Error("expected a refusal, got none");
}

function version(patch: Partial<ResolvedFileVersion> = {}): ResolvedFileVersion {
  return {
    fileId: "file_1" as FileId,
    fileVersionId: "fileVersion_1" as never,
    matterId: "matter_1" as MatterId,
    name: "contract.docx",
    sizeBytes: 100,
    contentSha256: "sha",
    status: "clean",
    ...patch,
  };
}

// THE CURSOR IS AN INDEX INTO THE PLAN DERIVED FROM THESE READS, and it survives an eviction while
// the plan does not — a resumed turn re-derives the plan and skips past the cursor. So the reads
// must impose a TOTAL ORDER that does not depend on the query planner: if two runs could return the
// same rows in a different order, a resumed turn would skip a document that was never written, and a
// document missing from a corpus with nobody able to tell is the one failure discovery cannot have.
describe("the selection reads impose a stable total order", () => {
  it("orders the file selection by the file's primary key", () => {
    const { database, lastSql } = recordingDatabase();
    selectCurrentVersionsForFilesStatement(database, ["file_b", "file_a"] as FileId[]);
    expect(lastSql()).toContain("ORDER BY file.id ASC");
  });

  it("orders the filed-message selection by the message's primary key", () => {
    const { database, lastSql } = recordingDatabase();
    selectFiledMessagesStatement(
      database,
      "matter_1" as MatterId,
      ["emailMessage_b", "emailMessage_a"] as EmailMessageId[],
    );
    expect(lastSql()).toContain("ORDER BY email_message.id ASC");
  });

  // The attachment read ends in the row's own id, so two attachments created in the same millisecond
  // cannot swap places between turns and renumber a family.
  it("breaks the attachment tie on the attachment's own primary key", () => {
    const { database, lastSql } = recordingDatabase();
    selectAttachmentsForMessagesStatement(database, ["emailMessage_a"] as EmailMessageId[]);
    expect(lastSql()).toContain("ORDER BY email_attachment.email_message_id ASC");
    expect(lastSql()).toContain("email_attachment.id ASC");
  });

  it("reads only filed links and only extracted attachments", () => {
    const { database, lastSql } = recordingDatabase();
    selectFiledMessagesStatement(
      database,
      "matter_1" as MatterId,
      ["emailMessage_a"] as EmailMessageId[],
    );
    // A message not filed to the matter is not the matter's correspondence, and a load reaching one
    // would be a load reaching outside the corpus it declared.
    expect(lastSql()).toContain("email_matter_link.state = 'filed'");

    selectAttachmentsForMessagesStatement(database, ["emailMessage_a"] as EmailMessageId[]);
    // A filtered inline image or an oversize part carries no file, so it produces no review document.
    expect(lastSql()).toContain("email_attachment.outcome = 'extracted'");
  });

  it("excludes deleted files from a selection", () => {
    const { database, lastSql } = recordingDatabase();
    selectCurrentVersionsForFilesStatement(database, ["file_a"] as FileId[]);
    expect(lastSql()).toContain("file.deleted_at IS NULL");
  });
});

describe("what a selection refuses", () => {
  it("refuses an empty selection and one past the ceiling", () => {
    expect(codeOf(() => assertSelectionSize(0))).toBe("discovery-selection-empty");
    expect(codeOf(() => assertSelectionSize(MAX_SELECTION_SIZE + 1))).toBe(
      "discovery-selection-too-large",
    );
    expect(() => assertSelectionSize(MAX_SELECTION_SIZE)).not.toThrow();
  });

  // REFUSED, never filtered. A firm that selected fifty files and silently received forty-eight
  // review documents has a corpus it cannot certify the contents of.
  it("refuses a version that is not clean, and names it", () => {
    let message = "";
    const unclean = [version(), version({ fileId: "file_2" as FileId, status: "quarantined" })];
    try {
      assertVersionsAreClean(unclean);
    } catch (caught) {
      message = (caught as DiscoveryValidationError).message;
    }
    expect(codeOf(() => assertVersionsAreClean(unclean))).toBe("discovery-version-not-clean");
    expect(message).toContain("file_2");
    expect(message).toContain("quarantined");
    expect(() => assertVersionsAreClean([version()])).not.toThrow();
  });

  // A version still pending its scan is not review material either — the rule is "clean", not "not
  // quarantined".
  it("refuses a version still pending its scan", () => {
    expect(codeOf(() => assertVersionsAreClean([version({ status: "pending" })]))).toBe(
      "discovery-version-not-clean",
    );
  });

  it("refuses a selection reaching outside the review set's matter", () => {
    expect(
      codeOf(() =>
        assertSelectionMatchesMatter(
          [version(), version({ fileId: "file_2" as FileId, matterId: "matter_2" as MatterId })],
          "matter_1" as MatterId,
        ),
      ),
    ).toBe("discovery-selection-matter-mismatch");
    expect(() => assertSelectionMatchesMatter([version()], "matter_1" as MatterId)).not.toThrow();
  });
});
