import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type {
  EmailAutoFileRuleId,
  EmailCaptureAddressId,
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  IdempotencyRecordId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  acceptStagedLinkStatement,
  captureIdempotencyKey,
  filedMatterIdsForMessage,
  findByDedupKey,
  findThreadIdsByMessageIds,
  insertEmailCaptureAddressStatement,
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailParticipantStatement,
  insertEmailThreadStatement,
  readCaptureOutcome,
  readEmailMatterLinksForMessage,
  readFiledMattersForThreads,
  readLiveCaptureAddressesForMatters,
  readMatterEmails,
  readRecentFilingTargets,
  revokeEmailCaptureAddressStatement,
  unlinkEmailFromMatterStatement,
  type EmailMessageInsert,
} from "../src/email-filing-statements.ts";
import { insertCompletedIdempotencyRecordStatement } from "../src/idempotency-statements.ts";
import type { BatchDatabase } from "../src/effect-batch.ts";

const NOW = "2026-07-17T10:00:00.000Z";

type Raw = import("node:sqlite").DatabaseSync;
let database: BatchDatabase;
let raw: Raw;

beforeEach(() => {
  const migrated = createMigratedNodeDatabase("per-firm");
  database = migrated.database as unknown as BatchDatabase;
  raw = migrated.raw;
});

function seedMatter(suffix: string): MatterId {
  const userId = `user_${suffix}`;
  const matterId = `matter_${suffix}`;
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES (?, 'Test User', 'active', 0, ?)`,
    )
    .run(userId, NOW);
  raw
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
       VALUES (?, 'Test Matter', 'open', ?, 0, ?, ?)`,
    )
    .run(matterId, userId, NOW, NOW);
  return matterId as MatterId;
}

function messageInput(overrides: Partial<EmailMessageInsert> = {}): EmailMessageInsert {
  return {
    id: "emailMessage_a" as EmailMessageId,
    messageIdValue: "<a@example.com>",
    messageIdProvenance: "header",
    subject: "Update",
    sentAt: NOW,
    receivedAt: NOW,
    fromDisplay: "Alice",
    fromAddress: "alice@example.com",
    threadId: "emailThread_a" as EmailThreadId,
    inReplyTo: null,
    contentSha256: "sha-a",
    dedupKey: "messageId:header:<a@example.com>",
    originalR2Key: "emails/emailMessage_a/original",
    referencesRemoteContent: false,
    integrity: "{}",
    dkimVerdict: "unverified",
    dkimVerdictReason: null,
    dkimVerifiedDomain: null,
    sourceFormat: "eml",
    capturedVia: "api",
    ...overrides,
  };
}

async function seedMessage(input: EmailMessageInsert): Promise<void> {
  await database.batch([
    insertEmailThreadStatement(
      database,
      { id: input.threadId, subjectNormalized: "update", firstSeenAt: NOW },
      NOW,
    ),
    insertEmailMessageStatement(database, input, NOW),
    insertEmailParticipantStatement(
      database,
      {
        id: "emailParticipant_1" as EmailParticipantId,
        emailMessageId: input.id,
        kind: "from",
        displayName: "Alice",
        address: "alice@example.com",
        directoryEntityId: null,
      },
      NOW,
    ),
  ]);
}

describe("email-filing statements", () => {
  it("findByDedupKey resolves a captured message and its thread; a miss is null", async () => {
    await seedMessage(messageInput());
    const hit = await findByDedupKey(database, "messageId:header:<a@example.com>");
    expect(hit?.id).toBe("emailMessage_a");
    expect(hit?.threadId).toBe("emailThread_a");
    expect(await findByDedupKey(database, "messageId:header:<nope@example.com>")).toBe(null);
  });

  it("linking is unique and idempotent on the (message, matter) pair", async () => {
    await seedMessage(messageInput());
    const matterId = seedMatter("one0000000000000000");
    const link = {
      id: "emailMatterLink_a" as EmailMatterLinkId,
      emailMessageId: "emailMessage_a" as EmailMessageId,
      matterId,
      state: "staged" as const,
      linkedBy: null,
      linkedAt: null,
      capturedVia: "api" as const,
    };
    await database.batch([insertEmailMatterLinkStatement(database, link, NOW)]);
    // A second identical stage (a different link id) is a no-op — one link, no error.
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        { ...link, id: "emailMatterLink_b" as EmailMatterLinkId },
        NOW,
      ),
    ]);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM email_matter_link WHERE email_message_id = ?1")
      .bind("emailMessage_a")
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("a matter's email list shows a link only once it is filed", async () => {
    await seedMessage(messageInput());
    const matterId = seedMatter("one0000000000000000");
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_a" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId,
          state: "staged",
          linkedBy: null,
          linkedAt: null,
          capturedVia: "api",
        },
        NOW,
      ),
    ]);
    // Staged: not yet in the matter's list.
    expect((await readMatterEmails(database, matterId, undefined)).data).toHaveLength(0);
    // Accept → filed → appears.
    await database.batch([
      acceptStagedLinkStatement(
        database,
        {
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId,
          linkedBy: "user_x" as UserId,
        },
        NOW,
      ),
    ]);
    const page = await readMatterEmails(database, matterId, undefined);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.emailMessageId).toBe("emailMessage_a");
    expect(page.data[0]?.linkState).toBe("filed");
    // Unlink removes it from the matter without deleting the message.
    await database.batch([
      unlinkEmailFromMatterStatement(
        database,
        { emailMessageId: "emailMessage_a" as EmailMessageId, matterId },
        NOW,
      ),
    ]);
    expect((await readMatterEmails(database, matterId, undefined)).data).toHaveLength(0);
    expect(await findByDedupKey(database, "messageId:header:<a@example.com>")).not.toBe(null);
  });

  it("filedMatterIdsForMessage returns every filed matter (staged/unlinked excluded) for the wall filter", async () => {
    await seedMessage(messageInput());
    const one = seedMatter("vis0000000000000000");
    const two = seedMatter("wal0000000000000000");
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_v" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId: one,
          state: "filed",
          linkedBy: "user_x" as UserId,
          linkedAt: NOW,
          capturedVia: "api",
        },
        NOW,
      ),
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_w" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId: two,
          state: "staged", // not filed → excluded from the "also on" set
          linkedBy: null,
          linkedAt: null,
          capturedVia: "api",
        },
        NOW,
      ),
    ]);
    const filed = await filedMatterIdsForMessage(database, "emailMessage_a" as EmailMessageId);
    expect(filed).toEqual([one]); // only the filed link; the caller's route then wall-filters this set
  });

  it("resolves claimed ancestors to their threads for DAG linking", async () => {
    await seedMessage(messageInput());
    const map = await findThreadIdsByMessageIds(database, [
      "<a@example.com>",
      "<unknown@example.com>",
    ]);
    expect(map.get("<a@example.com>")).toBe("emailThread_a");
    expect(map.has("<unknown@example.com>")).toBe(false);
    expect((await findThreadIdsByMessageIds(database, [])).size).toBe(0);
  });

  it("paginates a matter's emails across pages via the keyset cursor (JOIN'd columns stay unambiguous)", async () => {
    const matterId = seedMatter("pag0000000000000000");
    await database.batch([
      insertEmailThreadStatement(
        database,
        { id: "emailThread_p" as EmailThreadId, subjectNormalized: "p", firstSeenAt: NOW },
        NOW,
      ),
    ]);
    // Three messages filed to one matter, with strictly increasing link timestamps.
    for (let i = 0; i < 3; i += 1) {
      const at = `2026-07-1${i + 1}T00:00:00.000Z`;
      await database.batch([
        insertEmailMessageStatement(
          database,
          messageInput({
            id: `emailMessage_p${i}` as EmailMessageId,
            threadId: "emailThread_p" as EmailThreadId,
            messageIdValue: `<p${i}@example.com>`,
            dedupKey: `messageId:header:<p${i}@example.com>`,
            contentSha256: `sha-p${i}`,
            originalR2Key: `emails/p${i}/original`,
          }),
          at,
        ),
        insertEmailMatterLinkStatement(
          database,
          {
            id: `emailMatterLink_p${i}` as EmailMatterLinkId,
            emailMessageId: `emailMessage_p${i}` as EmailMessageId,
            matterId,
            state: "filed",
            linkedBy: null,
            linkedAt: at,
            capturedVia: "api",
          },
          at,
        ),
      ]);
    }
    const page1 = await readMatterEmails(database, matterId, undefined, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBe(null);
    // Page 2 with the cursor must not throw (the JOIN'd created_at/id were ambiguous before the fix).
    const page2 = await readMatterEmails(database, matterId, page1.nextCursor ?? undefined, 2);
    expect(page2.data).toHaveLength(1);
    // No message repeats across the two pages.
    const seen = new Set([...page1.data, ...page2.data].map((r) => r.emailMessageId));
    expect(seen.size).toBe(3);
  });

  it("records which rule made a link, and reads every link back with that distinction", async () => {
    await seedMessage(messageInput());
    const personMatter = seedMatter("one0000000000000000");
    const ruleMatter = seedMatter("two0000000000000000");
    const ruleId = "emailAutoFileRule_a" as EmailAutoFileRuleId;
    raw
      .prepare(
        `INSERT INTO email_auto_file_rule
           (id, kind, matter_id, match_value, promotion, state, created_at, updated_at)
         VALUES (?, 'threadContinuation', ?, 'emailThread_a', 'stage', 'active', ?, ?)`,
      )
      .run(ruleId, ruleMatter, NOW, NOW);
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_person" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId: personMatter,
          state: "filed",
          linkedBy: null,
          linkedAt: NOW,
          capturedVia: "api",
        },
        NOW,
      ),
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_rule" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId: ruleMatter,
          state: "staged",
          linkedBy: null,
          linkedAt: null,
          capturedVia: "forward",
          autoFileRuleId: ruleId,
        },
        NOW,
      ),
    ]);
    const links = await readEmailMatterLinksForMessage(
      database,
      "emailMessage_a" as EmailMessageId,
    );
    expect(links).toEqual([
      { matterId: personMatter, state: "filed", automatic: false },
      { matterId: ruleMatter, state: "staged", automatic: true },
    ]);
  });

  it("reads back an unlinked row, which is the record a rule may never contradict", async () => {
    await seedMessage(messageInput());
    const matterId = seedMatter("one0000000000000000");
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        {
          id: "emailMatterLink_a" as EmailMatterLinkId,
          emailMessageId: "emailMessage_a" as EmailMessageId,
          matterId,
          state: "filed",
          linkedBy: null,
          linkedAt: NOW,
          capturedVia: "api",
        },
        NOW,
      ),
    ]);
    await database.batch([
      unlinkEmailFromMatterStatement(
        database,
        { emailMessageId: "emailMessage_a" as EmailMessageId, matterId },
        NOW,
      ),
    ]);
    // filedMatterIdsForMessage no longer reports it — but the link read still does, which is the
    // whole point: "a person removed this" is a fact, not an absence.
    expect(await filedMatterIdsForMessage(database, "emailMessage_a" as EmailMessageId)).toEqual(
      [],
    );
    expect(
      await readEmailMatterLinksForMessage(database, "emailMessage_a" as EmailMessageId),
    ).toEqual([{ matterId, state: "unlinked", automatic: false }]);
  });
});

describe("the mail-client reads", () => {
  // A second message in the SAME thread — the thread row already exists, so only the message is
  // written. This is the shape the thread-continuation signal reads: several messages, one thread.
  async function seedReply(id: string, messageIdValue: string): Promise<void> {
    await database.batch([
      insertEmailMessageStatement(
        database,
        messageInput({
          id: id as EmailMessageId,
          messageIdValue,
          dedupKey: `messageId:header:${messageIdValue}`,
          contentSha256: `sha-${id}`,
        }),
        NOW,
      ),
    ]);
  }

  async function link(
    id: string,
    emailMessageId: string,
    matterId: MatterId,
    state: "staged" | "filed",
    linkedBy: UserId | null,
    at: string,
  ): Promise<void> {
    await database.batch([
      insertEmailMatterLinkStatement(
        database,
        {
          id: id as EmailMatterLinkId,
          emailMessageId: emailMessageId as EmailMessageId,
          matterId,
          state,
          linkedBy,
          linkedAt: state === "filed" ? at : null,
          capturedVia: "addin",
        },
        at,
      ),
    ]);
  }

  it("readFiledMattersForThreads reports each matter a thread is filed to, once, newest first", async () => {
    await seedMessage(messageInput());
    await seedReply("emailMessage_b", "<b@example.com>");
    const older = seedMatter("older000000000000000");
    const newer = seedMatter("newer000000000000000");
    await link(
      "emailMatterLink_1",
      "emailMessage_a",
      older,
      "filed",
      null,
      "2026-07-17T09:00:00.000Z",
    );
    await link(
      "emailMatterLink_2",
      "emailMessage_b",
      older,
      "filed",
      null,
      "2026-07-17T09:30:00.000Z",
    );
    await link(
      "emailMatterLink_3",
      "emailMessage_a",
      newer,
      "filed",
      null,
      "2026-07-17T11:00:00.000Z",
    );

    const hits = await readFiledMattersForThreads(database, ["emailThread_a" as EmailThreadId]);
    expect(hits.map((hit) => hit.matterId)).toEqual([newer, older]);
    expect(hits[1]?.lastFiledAt).toBe("2026-07-17T09:30:00.000Z");
  });

  it("readFiledMattersForThreads ignores staged and unlinked links, and an empty input", async () => {
    await seedMessage(messageInput());
    const matterId = seedMatter("staged00000000000000");
    await link("emailMatterLink_s", "emailMessage_a", matterId, "staged", null, NOW);
    expect(await readFiledMattersForThreads(database, ["emailThread_a" as EmailThreadId])).toEqual(
      [],
    );
    expect(await readFiledMattersForThreads(database, [])).toEqual([]);
  });

  it("readRecentFilingTargets is per-member, newest first, and counts the member's own filings", async () => {
    await seedMessage(messageInput());
    await seedReply("emailMessage_b", "<b@example.com>");
    const mine = seedMatter("mine0000000000000000");
    const theirs = seedMatter("theirs00000000000000");
    const me = "user_recent_me" as UserId;
    const them = "user_recent_them" as UserId;
    await link(
      "emailMatterLink_1",
      "emailMessage_a",
      mine,
      "filed",
      me,
      "2026-07-17T09:00:00.000Z",
    );
    await link(
      "emailMatterLink_2",
      "emailMessage_b",
      mine,
      "filed",
      me,
      "2026-07-17T10:00:00.000Z",
    );
    await link(
      "emailMatterLink_3",
      "emailMessage_a",
      theirs,
      "filed",
      them,
      "2026-07-17T11:00:00.000Z",
    );

    const targets = await readRecentFilingTargets(database, me, 10);
    expect(targets).toEqual([
      { matterId: mine, lastFiledAt: "2026-07-17T10:00:00.000Z", filedCount: 2 },
    ]);
  });

  it("readRecentFilingTargets honours its limit", async () => {
    await seedMessage(messageInput());
    const me = "user_recent_limit" as UserId;
    const first = seedMatter("first000000000000000");
    const second = seedMatter("second00000000000000");
    await link(
      "emailMatterLink_1",
      "emailMessage_a",
      first,
      "filed",
      me,
      "2026-07-17T09:00:00.000Z",
    );
    await link(
      "emailMatterLink_2",
      "emailMessage_a",
      second,
      "filed",
      me,
      "2026-07-17T10:00:00.000Z",
    );
    const targets = await readRecentFilingTargets(database, me, 1);
    expect(targets.map((target) => target.matterId)).toEqual([second]);
  });

  it("readLiveCaptureAddressesForMatters returns only live per-matter addresses for the named matters", async () => {
    const withAddress = seedMatter("withaddr000000000000");
    const without = seedMatter("noaddress00000000000");
    await database.batch([
      insertEmailCaptureAddressStatement(
        database,
        {
          id: "emailCaptureAddress_live" as EmailCaptureAddressId,
          token: "livetoken0000",
          kind: "matter",
          matterId: withAddress,
          createdBy: null,
        },
        NOW,
      ),
      insertEmailCaptureAddressStatement(
        database,
        {
          id: "emailCaptureAddress_dead" as EmailCaptureAddressId,
          token: "deadtoken0000",
          kind: "matter",
          matterId: withAddress,
          createdBy: null,
        },
        NOW,
      ),
    ]);
    await database.batch([
      revokeEmailCaptureAddressStatement(
        database,
        "emailCaptureAddress_dead" as EmailCaptureAddressId,
        NOW,
      ),
    ]);

    const live = await readLiveCaptureAddressesForMatters(database, [withAddress, without]);
    expect(live.map((row) => row.id)).toEqual(["emailCaptureAddress_live"]);
    expect(await readLiveCaptureAddressesForMatters(database, [])).toEqual([]);
  });

  it("readCaptureOutcome reads back what the capture consumer recorded, and null before it lands", async () => {
    expect(await readCaptureOutcome(database, "job0001")).toBe(null);
    await database.batch([
      insertCompletedIdempotencyRecordStatement(database, {
        id: "idempotencyRecord_1" as IdempotencyRecordId,
        key: captureIdempotencyKey("job0001"),
        fingerprint: "job0001",
        responseCode: 200,
        responseBody: JSON.stringify({
          emailMessageId: "emailMessage_a",
          threadId: "emailThread_a",
          matterId: "matter_x",
          linkState: "filed",
          deduplicated: true,
        }),
        createdAt: NOW,
      }),
    ]);
    expect(await readCaptureOutcome(database, "job0001")).toEqual({
      emailMessageId: "emailMessage_a",
      threadId: "emailThread_a",
      matterId: "matter_x",
      linkState: "filed",
      deduplicated: true,
    });
  });

  it("readCaptureOutcome refuses a record whose body is not a capture outcome", async () => {
    await database.batch([
      insertCompletedIdempotencyRecordStatement(database, {
        id: "idempotencyRecord_2" as IdempotencyRecordId,
        key: captureIdempotencyKey("job0002"),
        fingerprint: "job0002",
        responseCode: 200,
        responseBody: JSON.stringify({ somethingElse: true }),
        createdAt: NOW,
      }),
    ]);
    expect(await readCaptureOutcome(database, "job0002")).toBe(null);
  });
});
