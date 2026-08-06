import { describe, expect, it } from "vitest";
import {
  allocatedIdentifiers,
  chunkAllocations,
  planEmailAllocations,
  planFileAllocations,
  type AllocationContext,
} from "../src/allocation.ts";
import { REVIEW_DOCUMENT_INSERT_BATCH_SIZE } from "../src/limits.ts";
import type {
  ResolvedEmailAttachment,
  ResolvedEmailMessage,
  ResolvedFileVersion,
} from "../src/internal-lane.ts";
import type {
  DiscoveryLoadId,
  EmailMessageId,
  FileId,
  FileVersionId,
  MatterId,
  RecordCustodianId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";

const context: AllocationContext = {
  reviewSetId: "reviewSet_test000000000000000000" as ReviewSetId,
  discoveryLoadId: "discoveryLoad_test0000000000000000" as DiscoveryLoadId,
  recordCustodianId: "recordCustodian_test00000000000000" as RecordCustodianId,
};

function version(index: number): ResolvedFileVersion {
  return {
    fileId: `file_${index}` as FileId,
    fileVersionId: `fileVersion_${index}` as FileVersionId,
    matterId: "matter_test" as MatterId,
    name: `document-${index}.docx`,
    sizeBytes: 1024 * index,
    contentSha256: `sha-${index}`,
    status: "clean",
  };
}

function message(index: number): ResolvedEmailMessage {
  return {
    emailMessageId: `emailMessage_${index}` as EmailMessageId,
    subject: `Re: matter ${index}`,
    sentAt: "2026-08-01T09:00:00.000Z",
    receivedAt: "2026-08-01T09:00:05.000Z",
    contentSha256: `message-sha-${index}`,
    dedupKey: `dedup-${index}`,
  };
}

function attachment(messageIndex: number, index: number): ResolvedEmailAttachment {
  return {
    emailMessageId: `emailMessage_${messageIndex}` as EmailMessageId,
    fileId: `file_${messageIndex}_${index}` as FileId,
    fileVersionId: `fileVersion_${messageIndex}_${index}` as FileVersionId,
    filename: `exhibit-${index}.pdf`,
    sizeBytes: 2048,
    contentSha256: `attachment-sha-${messageIndex}-${index}`,
    status: "clean",
  };
}

describe("planning a file selection", () => {
  it("makes every file a standalone document that is its own family", () => {
    const rows = planFileAllocations([version(1), version(2)], context);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.sourceKind).toBe("file_version");
      expect(row.emailMessageId).toBeNull();
      // A standalone document IS its own family. Every document has one, so no read has a special
      // case for the lonely ones — and the schema CHECK holds it.
      expect(row.familyId).toBe(row.id);
      expect(row.familyRole).toBe("standalone");
      expect(row.familySequence).toBe(0);
    }
    // The version is PINNED. Loading is a snapshot of a version, not a subscription to a file.
    expect(rows[0]?.fileVersionId).toBe("fileVersion_1");
    // The hash was already computed at ingest, so exact dedup is free at load time.
    expect(rows[0]?.contentSha256).toBe("sha-1");
  });

  it("mints a distinct identifier per row", () => {
    const rows = planFileAllocations([version(1), version(2), version(3)], context);
    expect(new Set(allocatedIdentifiers(rows)).size).toBe(3);
  });
});

describe("planning an email selection", () => {
  // An email and its attachments are ONE family and must stay together: a responsive attachment
  // makes its parent responsive, a privileged parent taints its attachments, and a production that
  // breaks a family will be challenged.
  it("keeps a message and its attachments in one family under the message's identifier", () => {
    const rows = planEmailAllocations(
      [message(1)],
      [attachment(1, 1), attachment(1, 2)],
      context,
    );
    expect(rows).toHaveLength(3);
    const [parent, first, second] = rows as [
      (typeof rows)[number],
      (typeof rows)[number],
      (typeof rows)[number],
    ];
    expect(parent.sourceKind).toBe("email_message");
    expect(parent.familyRole).toBe("parent");
    expect(parent.familyId).toBe(parent.id);
    expect(parent.familySequence).toBe(0);
    for (const child of [first, second]) {
      expect(child.sourceKind).toBe("email_attachment");
      expect(child.familyRole).toBe("attachment");
      // The parent's own identifier IS the family identifier, so a family is one indexed read.
      expect(child.familyId).toBe(parent.id);
      expect(child.fileVersionId).not.toBeNull();
      expect(child.emailMessageId).toBeNull();
    }
    // One-based on the children so the parent's zero is unambiguous.
    expect(first.familySequence).toBe(1);
    expect(second.familySequence).toBe(2);
  });

  // A `parent` role on a one-member family would make every family read ask "is this a real
  // family", which is the question the role exists to answer.
  it("makes a message with no extracted attachments standalone rather than a parent of nothing", () => {
    const rows = planEmailAllocations([message(1)], [], context);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.familyRole).toBe("standalone");
    expect(rows[0]?.familyId).toBe(rows[0]?.id);
  });

  it("keeps two messages' families apart", () => {
    const rows = planEmailAllocations(
      [message(1), message(2)],
      [attachment(1, 1), attachment(2, 1)],
      context,
    );
    expect(rows).toHaveLength(4);
    const families = new Set(rows.map((row) => row.familyId));
    expect(families.size).toBe(2);
  });
});

describe("chunking", () => {
  // A load must never be N single-row commits and must never be one giant batch either; both walls
  // are real, and the constant carries its derivation beside it in limits.ts.
  it("splits at the batch size and loses nothing", () => {
    const rows = planFileAllocations(
      Array.from({ length: 250 }, (_, index) => version(index)),
      context,
    );
    const chunks = chunkAllocations(rows);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(REVIEW_DOCUMENT_INSERT_BATCH_SIZE);
    expect(chunks[2]).toHaveLength(250 - 2 * REVIEW_DOCUMENT_INSERT_BATCH_SIZE);
    expect(chunks.flat()).toHaveLength(250);
    expect(chunks.flat().map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it("returns no chunks for an empty plan", () => {
    expect(chunkAllocations([])).toEqual([]);
  });
});
