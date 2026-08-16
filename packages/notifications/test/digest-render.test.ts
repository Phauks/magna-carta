import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { composeDigest, readDigestWindow, type DigestComposition } from "../src/digest.ts";
import { renderNotificationDigest } from "../src/digest-render.ts";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "../src/types.ts";

// THE TEST THAT MAKES THE CONTENT BOUNDARY STRUCTURAL.
//
// A fixture whose matters carry deliberately identifying titles and numbers — the sentence that must
// never exist in an email — is rendered end to end, and every one of those strings is asserted
// absent from the subject and the body. If somebody widens the renderer to "just the matter number,
// it's meaningless without our systems", this fails before it reaches a mailbox.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-16T14:00:00.000Z";
const READER = "user_reader000000000";
const APP_BASE_URL = "https://app.example";

// Strings a firm would actually type. Every one of them is client-identifying, and none may appear
// in anything this file renders.
const IDENTIFYING = Object.freeze([
  "Ellison v. Braddock",
  "Ellison",
  "Braddock",
  "8181-3",
  "Response to motion for summary judgment",
  "Deposition transcript — Ellison.pdf",
  "Retainer balance below threshold",
]);

let database: Database;

async function seedIdentifyingFirm(): Promise<void> {
  await database
    .prepare(
      "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, 'Reader', 'active', 0, ?2)",
    )
    .bind(READER, NOW)
    .run();
  await database
    .prepare(
      "INSERT INTO matter (id, title, matter_number, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, ?3, 'open', ?4, 0, ?5, ?5)",
    )
    .bind("matter_ellison00000a", "Ellison v. Braddock", "8181-3", READER, NOW)
    .run();

  const seeds: readonly { category: NotificationCategory; kind: string }[] = [
    { category: "deadlines", kind: "deadlines.deadline.overdue" },
    { category: "deadlines", kind: "deadlines.deadline.due" },
    { category: "deadlines", kind: "deadlines.deadline.due" },
    { category: "trust", kind: "trust.ledger.entry.posted" },
    { category: "documents", kind: "documents.file.quarantined" },
    { category: "documents", kind: "documents.checkinConflict" },
  ];
  for (const [index, seed] of seeds.entries()) {
    const eventId = `notificationEvent_${String(index).padStart(4, "0")}`;
    await database
      .prepare(
        "INSERT INTO notification_event (id, kind, category, severity, subject_kind, subject_id, matter_id, occurred_at, facts, dedupe_key, created_at) VALUES (?1, ?2, ?3, 'attention', 'matter', 'matter_ellison00000a', 'matter_ellison00000a', ?4, NULL, ?5, ?4)",
      )
      .bind(eventId, seed.kind, seed.category, NOW, `dedupe_${eventId}`)
      .run();
    await database
      .prepare(
        "INSERT INTO notification_recipient (id, notification_event_id, recipient_user_id, state, read_at, dismissed_at, created_at) VALUES (?1, ?2, ?3, 'unread', NULL, NULL, ?4)",
      )
      .bind(`notificationRecipient_${String(index).padStart(4, "0")}`, eventId, READER, NOW)
      .run();
  }
}

async function composeOverFixture(): Promise<DigestComposition> {
  const window = await readDigestWindow(
    database,
    { recipientUserId: READER, visibility: visibleMatterPredicate() },
    null,
  );
  return composeDigest({ cadence: "daily", window, cadenceForCategory: () => "daily" });
}

beforeEach(async () => {
  database = createMigratedNodeDatabase("per-firm").database;
  await seedIdentifyingFirm();
});

describe("the content boundary", () => {
  it("names no matter, client, document, or amount anywhere in a rendered summary", async () => {
    const rendered = renderNotificationDigest({
      composition: await composeOverFixture(),
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });

    const everything = `${rendered.subject}\n${rendered.text}`;
    for (const identifying of IDENTIFYING) {
      expect(everything, `a summary must never carry "${identifying}"`).not.toContain(identifying);
    }
    // And nothing that looks like a handle either: a subject id is not client-identifying on its
    // own, but it is a key into the firm's own records and has no business in a mailbox.
    expect(everything).not.toContain("matter_ellison00000a");
    expect(everything).not.toContain("notificationEvent_");
    expect(everything).not.toContain("notificationRecipient_");
  });

  it("renders the whole summary as counts, a cadence, and one link", async () => {
    const rendered = renderNotificationDigest({
      composition: await composeOverFixture(),
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });

    expect(rendered.subject).toBe("Magna Carta — 6 items need your attention");
    expect(rendered.text).toContain("Deadlines 3 · Documents 2 · Trust 1");
    expect(rendered.text).toContain("Open your notifications: https://app.example/notifications");
    expect(rendered.text).toContain("daily summary");
  });

  it("says at least N when the window was capped, rather than a number it cannot stand behind", async () => {
    const composition = await composeOverFixture();
    const rendered = renderNotificationDigest({
      composition: { ...composition, atLeast: true },
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });
    expect(rendered.subject).toBe("Magna Carta — at least 6 items need your attention");
  });

  it("reads as one item rather than 1 items", async () => {
    const composition = await composeOverFixture();
    const rendered = renderNotificationDigest({
      composition: { ...composition, counts: [{ category: "trust", count: 1 }], totalCount: 1 },
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });
    expect(rendered.subject).toBe("Magna Carta — 1 item needs your attention");
  });

  it("renders the declared-and-unbuilt detail level at its most private reading", async () => {
    // `matter-number` is in the vocabulary so a firm's stored ceiling is not silently rewritten when
    // the level ships. Until it does, it renders exactly as `counts-only` — never as a matter number
    // by accident.
    const composition = await composeOverFixture();
    const countsOnly = renderNotificationDigest({
      composition,
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });
    const declared = renderNotificationDigest({
      composition,
      detailLevel: "matter-number",
      appBaseUrl: APP_BASE_URL,
    });
    expect(declared).toEqual(countsOnly);
  });

  it("gives every category in the vocabulary a reader-facing label", async () => {
    // An unlabelled category would mail somebody the raw registry key. The renderer's map is typed
    // exhaustive, and this proves the vocabulary and the labels agree at runtime too.
    const composition = await composeOverFixture();
    const rendered = renderNotificationDigest({
      composition: {
        ...composition,
        counts: NOTIFICATION_CATEGORIES.map((category) => ({ category, count: 1 })),
        totalCount: NOTIFICATION_CATEGORIES.length,
      },
      detailLevel: "counts-only",
      appBaseUrl: APP_BASE_URL,
    });
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(rendered.text.toLowerCase()).toContain(category.toLowerCase());
    }
    expect(rendered.text).not.toContain("undefined");
  });

  it("tolerates a base URL with a trailing slash without doubling it", async () => {
    const rendered = renderNotificationDigest({
      composition: await composeOverFixture(),
      detailLevel: "counts-only",
      appBaseUrl: "https://app.example/",
    });
    expect(rendered.text).toContain("https://app.example/notifications");
    expect(rendered.text).not.toContain("https://app.example//notifications");
  });
});

describe("the renderer's inputs", () => {
  it("reads no title-shaped column anywhere in the digest path", async () => {
    // The structural half of the boundary: the read the renderer is fed selects a category, a kind,
    // an instant, and two handles. A scan rather than a review comment, because a widened SELECT is
    // exactly the change that would pass every other test in this suite.
    const digestSource = await readFile(
      join(import.meta.dirname, "..", "src", "digest.ts"),
      "utf8",
    );
    const renderSource = await readFile(
      join(import.meta.dirname, "..", "src", "digest-render.ts"),
      "utf8",
    );
    for (const forbidden of ["title", "display_name", "matter_number", "subject_id", "facts"]) {
      expect(digestSource, `the digest read must not name ${forbidden}`).not.toContain(
        `.${forbidden}`,
      );
      expect(renderSource, `the renderer must not name ${forbidden}`).not.toContain(
        `.${forbidden}`,
      );
    }
  });
});
