import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { explainStatement, findFullScans, type LabeledPlan } from "./runner.ts";

// The email-filing volume-shaped reads join the load harness in-area (the accretion rule): a matter's
// filed emails, a thread's messages, the "already filed" lookup (by Message-ID and by content hash),
// the dedup probe, and the multi-matter "also on" read. Each must walk an index — never a full table
// scan — at volume, which is what the record model's indexes exist to guarantee. This seeds its own
// email volume over a modest matter set (self-contained, so it never perturbs the shared snapshot's
// generator identity) and asserts every hot read is scan-free.

const NOW = "2026-07-17T00:00:00.000Z";
const MATTER_COUNT = 40;
const THREADS = 30;
const MESSAGES_PER_THREAD = 8;

function seedVolume(raw: import("node:sqlite").DatabaseSync): {
  matterId: string;
  threadId: string;
  emailMessageId: string;
} {
  raw
    .prepare(
      `INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at)
       VALUES ('user_lp', 'LP', 'active', 0, ?)`,
    )
    .run(NOW);
  const matterIds: string[] = [];
  for (let m = 0; m < MATTER_COUNT; m += 1) {
    const matterId = `matter_lp_${m}`;
    raw
      .prepare(
        `INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at)
         VALUES (?, 'M', 'open', 'user_lp', 0, ?, ?)`,
      )
      .run(matterId, NOW, NOW);
    matterIds.push(matterId);
  }

  let firstMessageId = "";
  let firstThreadId = "";
  let counter = 0;
  const insertThread = raw.prepare(
    "INSERT INTO email_thread (id, subject_normalized, first_seen_at, created_at, updated_at) VALUES (?, 'subj', ?, ?, ?)",
  );
  const insertMessage = raw.prepare(
    `INSERT INTO email_message
       (id, message_id_value, message_id_provenance, subject, received_at, thread_id, content_sha256, dedup_key, original_r2_key, references_remote_content, integrity, dkim_verdict, source_format, captured_via, created_at, updated_at)
     VALUES (?, ?, 'header', 'S', ?, ?, ?, ?, ?, 0, '{}', 'unverified', 'eml', 'api', ?, ?)`,
  );
  const insertParticipant = raw.prepare(
    "INSERT INTO email_participant (id, email_message_id, kind, display_name, address, directory_entity_id, created_at, updated_at) VALUES (?, ?, 'from', 'X', 'x@example.test', NULL, ?, ?)",
  );
  const insertLink = raw.prepare(
    "INSERT INTO email_matter_link (id, email_message_id, matter_id, state, linked_by, linked_at, captured_via, created_at, updated_at) VALUES (?, ?, ?, 'filed', 'user_lp', ?, 'api', ?, ?)",
  );

  for (let t = 0; t < THREADS; t += 1) {
    const threadId = `emailThread_lp_${t}`;
    insertThread.run(threadId, NOW, NOW, NOW);
    if (t === 0) firstThreadId = threadId;
    for (let i = 0; i < MESSAGES_PER_THREAD; i += 1) {
      const id = `emailMessage_lp_${(counter += 1)}`;
      const messageIdValue = `<lp-${counter}@example.test>`;
      insertMessage.run(
        id,
        messageIdValue,
        NOW,
        threadId,
        `sha-${counter}`,
        `messageId:header:${messageIdValue}`,
        `emails/${id}/original`,
        NOW,
        NOW,
      );
      insertParticipant.run(`emailParticipant_lp_${counter}`, id, NOW, NOW);
      // Spread links across matters; give the first message links on several matters (the "also on" read).
      const matterId = matterIds[counter % MATTER_COUNT]!;
      insertLink.run(`emailMatterLink_lp_${counter}`, id, matterId, NOW, NOW, NOW);
      // Give the first message links on several additional matters (the "also on" read), offset so they
      // never collide with any message's own primary link.
      if (counter >= 2 && counter <= 5) {
        insertLink.run(
          `emailMatterLink_lpx_${counter}`,
          `emailMessage_lp_1`,
          matterIds[20 + counter]!,
          NOW,
          NOW,
          NOW,
        );
      }
      if (firstMessageId === "") firstMessageId = id;
    }
  }
  return { matterId: matterIds[0]!, threadId: firstThreadId, emailMessageId: firstMessageId };
}

describe("email-filing volume-shaped reads (load profile)", () => {
  it("every hot read walks an index — no full table scan at volume", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const probe = seedVolume(raw);

    const plans: LabeledPlan[] = [
      {
        label: "readMatterEmails",
        details: explainStatement(
          raw,
          `SELECT email_matter_link.id AS id, email_matter_link.created_at AS created_at,
                  email_matter_link.state AS link_state, email_message.id AS email_message_id,
                  email_message.thread_id AS thread_id, email_message.subject AS subject,
                  email_message.from_display AS from_display, email_message.from_address AS from_address,
                  email_message.sent_at AS sent_at, email_message.received_at AS received_at
           FROM email_matter_link
           JOIN email_message ON email_message.id = email_matter_link.email_message_id
           WHERE email_matter_link.matter_id = ? AND email_matter_link.state = 'filed'
           ORDER BY email_matter_link.created_at DESC, email_matter_link.id DESC LIMIT ?`,
          [probe.matterId, 51],
        ),
      },
      {
        label: "readThreadMessages",
        details: explainStatement(
          raw,
          `SELECT id, subject, from_display, from_address, in_reply_to, sent_at, received_at
           FROM email_message WHERE thread_id = ? ORDER BY received_at ASC, id ASC`,
          [probe.threadId],
        ),
      },
      {
        label: "findByMessageIdValue",
        details: explainStatement(
          raw,
          "SELECT id FROM email_message WHERE message_id_value = ? LIMIT 1",
          ["<lp-1@example.test>"],
        ),
      },
      {
        label: "findByContentSha256",
        details: explainStatement(
          raw,
          "SELECT id FROM email_message WHERE content_sha256 = ? LIMIT 1",
          ["sha-1"],
        ),
      },
      {
        label: "findByDedupKey",
        details: explainStatement(
          raw,
          "SELECT id, thread_id FROM email_message WHERE dedup_key = ?",
          ["messageId:header:<lp-1@example.test>"],
        ),
      },
      {
        label: "filedMatterIdsForMessage",
        details: explainStatement(
          raw,
          "SELECT matter_id FROM email_matter_link WHERE email_message_id = ? AND state = 'filed' ORDER BY created_at ASC, id ASC",
          [probe.emailMessageId],
        ),
      },
      {
        label: "findCaptureAddressByToken",
        details: explainStatement(
          raw,
          "SELECT kind, matter_id FROM email_capture_address WHERE token = ? AND active = 1",
          ["matter-abc"],
        ),
      },
    ];

    expect(findFullScans(plans)).toEqual([]);
  });
});
