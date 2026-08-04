import { test, expect } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";

const NOW = "2026-07-17T00:00:00.000Z";

// Seed a member + matter pair to satisfy the email_matter_link FK chain (matter.responsible_member_id
// references member.user_id, so the member must exist first — the cost-entry migration test precedent).
function seedMatter(raw: import("node:sqlite").DatabaseSync, suffix: string): string {
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
  return matterId;
}

function seedMessage(raw: import("node:sqlite").DatabaseSync, id: string, dedupKey: string): void {
  raw
    .prepare(
      `INSERT INTO email_message
         (id, message_id_provenance, received_at, thread_id, content_sha256, dedup_key, original_r2_key, integrity, source_format, captured_via, created_at, updated_at)
       VALUES (?, 'header', ?, 'emailThread_a', ?, ?, ?, '{}', 'eml', 'api', ?, ?)`,
    )
    .run(id, NOW, `sha-${id}`, dedupKey, `emails/${id}/original`, NOW, NOW);
}

test("email-filing migration creates the message, thread, link, participant, attachment and capture-address tables", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const names = (
    raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  for (const t of [
    "email_thread",
    "email_message",
    "email_matter_link",
    "email_participant",
    "email_attachment",
    "email_capture_address",
  ]) {
    expect(names, `table ${t} should exist`).toContain(t);
  }
});

test("a duplicate dedup_key is rejected — one row per firm-unique message", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw
    .prepare(
      "INSERT INTO email_thread (id, first_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run("emailThread_a", NOW, NOW, NOW);
  seedMessage(raw, "emailMessage_a", "messageId:<x@example.com>");
  expect(() => seedMessage(raw, "emailMessage_b", "messageId:<x@example.com>")).toThrow();
});

test("a message cannot double-file to the same matter, but can link to many matters", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw
    .prepare(
      "INSERT INTO email_thread (id, first_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run("emailThread_a", NOW, NOW, NOW);
  seedMessage(raw, "emailMessage_a", "messageId:<x@example.com>");
  const matterOne = seedMatter(raw, "one0000000000000000");
  const matterTwo = seedMatter(raw, "two0000000000000000");
  const insertLink = raw.prepare(
    `INSERT INTO email_matter_link (id, email_message_id, matter_id, captured_via, created_at, updated_at)
     VALUES (?, 'emailMessage_a', ?, 'api', ?, ?)`,
  );
  insertLink.run("emailMatterLink_a", matterOne, NOW, NOW);
  // Same message, a different matter — allowed (the multi-matter junction).
  insertLink.run("emailMatterLink_b", matterTwo, NOW, NOW);
  // Same message, the same matter again — rejected by the (message, matter) unique index.
  expect(() => insertLink.run("emailMatterLink_c", matterOne, NOW, NOW)).toThrow();
});
