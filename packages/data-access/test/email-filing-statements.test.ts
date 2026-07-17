import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type {
  EmailMatterLinkId,
  EmailMessageId,
  EmailParticipantId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  acceptStagedLinkStatement,
  findByDedupKey,
  findThreadIdsByMessageIds,
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailParticipantStatement,
  insertEmailThreadStatement,
  mattersForMessageVisibleTo,
  readMatterEmails,
  unlinkEmailFromMatterStatement,
  type EmailMessageInsert,
} from "../src/email-filing-statements.ts";
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
      insertEmailMatterLinkStatement(database, { ...link, id: "emailMatterLink_b" as EmailMatterLinkId }, NOW),
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
        { emailMessageId: "emailMessage_a" as EmailMessageId, matterId, linkedBy: "user_x" as UserId },
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

  it("the visibility read returns only accessible matters and a bare total count for the rest", async () => {
    await seedMessage(messageInput());
    const visible = seedMatter("vis0000000000000000");
    const walled = seedMatter("wal0000000000000000");
    for (const [linkId, matterId] of [
      ["emailMatterLink_v", visible],
      ["emailMatterLink_w", walled],
    ] as const) {
      await database.batch([
        insertEmailMatterLinkStatement(
          database,
          {
            id: linkId as EmailMatterLinkId,
            emailMessageId: "emailMessage_a" as EmailMessageId,
            matterId,
            state: "filed",
            linkedBy: "user_x" as UserId,
            linkedAt: NOW,
            capturedVia: "api",
          },
          NOW,
        ),
      ]);
    }
    const visibility = await mattersForMessageVisibleTo(database, "emailMessage_a" as EmailMessageId, [
      visible,
    ]);
    expect(visibility.totalFiledCount).toBe(2); // filed to two matters
    expect(visibility.accessibleMatterIds).toEqual([visible]); // the walled one is never named
    // A caller who can see none of them learns only the count, never an identity.
    const blind = await mattersForMessageVisibleTo(database, "emailMessage_a" as EmailMessageId, []);
    expect(blind.accessibleMatterIds).toEqual([]);
    expect(blind.totalFiledCount).toBe(2);
  });

  it("resolves claimed ancestors to their threads for DAG linking", async () => {
    await seedMessage(messageInput());
    const map = await findThreadIdsByMessageIds(database, ["<a@example.com>", "<unknown@example.com>"]);
    expect(map.get("<a@example.com>")).toBe("emailThread_a");
    expect(map.has("<unknown@example.com>")).toBe(false);
    expect((await findThreadIdsByMessageIds(database, [])).size).toBe(0);
  });
});
