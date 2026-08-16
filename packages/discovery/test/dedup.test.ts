import { describe, expect, it } from "vitest";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewDocumentOccurrenceId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import {
  CONTENT_DEDUP_GROUP_PREFIX,
  EMAIL_DEDUP_GROUP_PREFIX,
  dedupGroupIdentifier,
} from "../src/dedup.ts";
import {
  claimDedupPrimaryStatement,
  insertReviewDocumentOccurrenceStatement,
  readDedupPrimary,
  readOccurrencesForPrimary,
  markReviewDocumentDuplicateStatement,
} from "../src/dedup-statements.ts";
import {
  ATTACHMENT_DOCUMENT,
  LOAD,
  PARENT_DOCUMENT,
  RECORD_CUSTODIAN,
  REVIEW_SET,
  STANDALONE_DOCUMENT,
  migratedDatabase,
} from "./support.ts";

// Deduplication decides what a reviewer never sees, so these are the properties that keep that
// decision honest: the identity is a hash and never a similarity score, exactly one copy holds
// primacy, and every suppressed copy stays reachable from the copy that was read.

const NOW = "2026-08-16T00:00:00.000Z";
const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("what makes two review documents the same document", () => {
  it("hashes the bytes for a file and reads the email model's own key for a message", () => {
    expect(
      dedupGroupIdentifier({
        sourceKind: "file_version",
        contentSha256: SHA,
        emailDedupKey: null,
      }),
    ).toBe(`${CONTENT_DEDUP_GROUP_PREFIX}${SHA}`);
    // A raw-bytes hash of an email is the WRONG identity: two copies of one message differ in their
    // transport headers, and the email subsystem already worked out the right one.
    expect(
      dedupGroupIdentifier({
        sourceKind: "email_message",
        contentSha256: SHA,
        emailDedupKey: "<message-id@example.test>",
      }),
    ).toBe(`${EMAIL_DEDUP_GROUP_PREFIX}<message-id@example.test>`);
  });

  it("declines to assert anything about bytes whose hash nobody recorded", () => {
    // Not a group of one, and not an error. A document with no identity is read on its own terms;
    // the cost is an extraction that might have been avoided, and the alternative cost is evidence
    // suppressed on a guess.
    expect(
      dedupGroupIdentifier({
        sourceKind: "file_version",
        contentSha256: null,
        emailDedupKey: null,
      }),
    ).toBeNull();
    expect(
      dedupGroupIdentifier({ sourceKind: "email_message", contentSha256: SHA, emailDedupKey: "" }),
    ).toBeNull();
  });

  it("keeps a content hash and an email key in different spaces", () => {
    const asFile = dedupGroupIdentifier({
      sourceKind: "file_version",
      contentSha256: "shared",
      emailDedupKey: null,
    });
    const asMessage = dedupGroupIdentifier({
      sourceKind: "email_message",
      contentSha256: null,
      emailDedupKey: "shared",
    });
    expect(asFile).not.toBe(asMessage);
  });
});

describe("exactly one copy of a document holds primacy", () => {
  it("refuses a second claim while a holder exists, and the loser is told who holds it", async () => {
    const { database, raw } = migratedDatabase();
    const group = `${CONTENT_DEDUP_GROUP_PREFIX}${SHA}`;

    await claimDedupPrimaryStatement(database, PARENT_DOCUMENT, REVIEW_SET, group, NOW).run();
    // A second copy runs the same statement. Its NOT EXISTS clause sees the holder and it writes
    // nothing — no exception, no second primary, and the group read tells it which copy won.
    await claimDedupPrimaryStatement(database, STANDALONE_DOCUMENT, REVIEW_SET, group, NOW).run();

    const holder = await readDedupPrimary(database, REVIEW_SET, group);
    expect(holder?.id).toBe(PARENT_DOCUMENT);

    const primaries = raw
      .prepare(
        `SELECT id FROM review_document WHERE review_set_id = ? AND dedup_group_id = ? ` +
          `AND is_dedup_primary = 1 ORDER BY id ASC`,
      )
      .all(REVIEW_SET, group) as { id: string }[];
    expect(primaries).toEqual([{ id: PARENT_DOCUMENT }]);
  });

  it("is held by the database as well as by the statement", async () => {
    const { database, raw } = migratedDatabase();
    const group = `${CONTENT_DEDUP_GROUP_PREFIX}${SHA}`;
    await claimDedupPrimaryStatement(database, PARENT_DOCUMENT, REVIEW_SET, group, NOW).run();
    // The write path nobody has written yet, doing the thing the guarded statement refuses to. The
    // partial unique index is what makes "that cannot happen" true rather than "we do not do that".
    expect(() =>
      raw
        .prepare(`UPDATE review_document SET dedup_group_id = ?, is_dedup_primary = 1 WHERE id = ?`)
        .run(group, STANDALONE_DOCUMENT),
    ).toThrow();
  });

  it("leaves a document with no group unconstrained, however many there are", () => {
    const { raw } = migratedDatabase();
    // NULL groups are distinct in a SQLite unique index, which is right: the platform is declining
    // to assert anything about these rows rather than putting them all in one group.
    const rows = raw
      .prepare(
        `SELECT COUNT(*) AS count FROM review_document ` +
          `WHERE dedup_group_id IS NULL AND is_dedup_primary = 1`,
      )
      .all() as { count: number }[];
    expect(rows[0]?.count).toBeGreaterThan(1);
  });
});

describe("a suppressed copy stays reachable", () => {
  it("answers which custodians held a document from one indexed read", async () => {
    const { database } = migratedDatabase();
    const group = `${CONTENT_DEDUP_GROUP_PREFIX}${SHA}`;
    await claimDedupPrimaryStatement(database, PARENT_DOCUMENT, REVIEW_SET, group, NOW).run();
    await markReviewDocumentDuplicateStatement(database, STANDALONE_DOCUMENT, group, NOW).run();
    await insertReviewDocumentOccurrenceStatement(
      database,
      {
        id: "reviewDocumentOccurrence_first0000000" as ReviewDocumentOccurrenceId,
        reviewSetId: REVIEW_SET,
        primaryReviewDocumentId: PARENT_DOCUMENT,
        duplicateReviewDocumentId: STANDALONE_DOCUMENT,
        recordCustodianId: RECORD_CUSTODIAN,
        discoveryLoadId: LOAD,
      },
      NOW,
    ).run();

    const occurrences = await readOccurrencesForPrimary(database, REVIEW_SET, PARENT_DOCUMENT);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.duplicate_review_document_id).toBe(STANDALONE_DOCUMENT);
    // The two facts deduplication would otherwise destroy.
    expect(occurrences[0]?.record_custodian_id).toBe(RECORD_CUSTODIAN);
    expect(occurrences[0]?.discovery_load_id).toBe(LOAD);
  });

  it("keeps the duplicate row itself, marked and attributed rather than deleted", async () => {
    const { database, raw } = migratedDatabase();
    const group = `${CONTENT_DEDUP_GROUP_PREFIX}${SHA}`;
    await markReviewDocumentDuplicateStatement(database, ATTACHMENT_DOCUMENT, group, NOW).run();
    const rows = raw
      .prepare(
        `SELECT id, is_dedup_primary, dedup_group_id, record_custodian_id FROM review_document ` +
          `WHERE id = ?`,
      )
      .all(ATTACHMENT_DOCUMENT) as {
      id: string;
      is_dedup_primary: number;
      dedup_group_id: string;
      record_custodian_id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_dedup_primary).toBe(0);
    expect(rows[0]?.dedup_group_id).toBe(group);
    // "Which custodians held this document" is asked under oath, and "we deleted that" is not an
    // answer. The attribution is still on the row.
    expect(rows[0]?.record_custodian_id).toBe(RECORD_CUSTODIAN);
  });

  it("records one copy behind exactly one primary, however often the message is redelivered", async () => {
    const { database, raw } = migratedDatabase();
    const row = {
      id: "reviewDocumentOccurrence_once00000000" as ReviewDocumentOccurrenceId,
      reviewSetId: REVIEW_SET,
      primaryReviewDocumentId: PARENT_DOCUMENT,
      duplicateReviewDocumentId: STANDALONE_DOCUMENT,
      recordCustodianId: RECORD_CUSTODIAN,
      discoveryLoadId: LOAD,
    };
    await insertReviewDocumentOccurrenceStatement(database, row, NOW).run();
    await insertReviewDocumentOccurrenceStatement(database, row, NOW).run();
    const counted = raw
      .prepare(`SELECT COUNT(*) AS count FROM review_document_occurrence`)
      .all() as { count: number }[];
    expect(counted[0]?.count).toBe(1);
  });
});
