import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";

const NOW = "2026-08-05T22:00:00.000Z";
const MIGRATION = join(
  import.meta.dirname,
  "..",
  "drizzle",
  "per-firm",
  "20260908T000000_baseline.sql",
);

type Raw = import("node:sqlite").DatabaseSync;

// The FK chain a rule needs: matter.responsible_member_id references member.user_id, so the member
// exists first (the email-filing migration test precedent).
function seedMatter(raw: Raw, suffix: string): string {
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

function seedMessage(raw: Raw, id: string): string {
  raw
    .prepare(
      "INSERT OR IGNORE INTO email_thread (id, first_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run("emailThread_a", NOW, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO email_message
         (id, message_id_provenance, received_at, thread_id, content_sha256, dedup_key,
          original_r2_key, integrity, source_format, captured_via, created_at, updated_at)
       VALUES (?, 'header', ?, 'emailThread_a', ?, ?, ?, '{}', 'eml', 'forward', ?, ?)`,
    )
    .run(id, NOW, `sha-${id}`, `messageId:<${id}@example.com>`, `emails/${id}/original`, NOW, NOW);
  return id;
}

interface RuleOverrides {
  readonly id?: string;
  readonly kind?: string;
  readonly promotion?: string;
  readonly state?: string;
  readonly suspendedReason?: string | null;
  readonly matchValue?: string;
}

function insertRule(raw: Raw, matterId: string, overrides: RuleOverrides = {}): void {
  raw
    .prepare(
      `INSERT INTO email_auto_file_rule
         (id, kind, matter_id, match_value, promotion, state, suspended_reason, created_by,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      overrides.id ?? "emailAutoFileRule_a",
      overrides.kind ?? "correspondentMatter",
      matterId,
      overrides.matchValue ?? "counsel@example.com",
      overrides.promotion ?? "stage",
      overrides.state ?? "active",
      overrides.suspendedReason ?? null,
      NOW,
      NOW,
    );
}

interface DecisionOverrides {
  readonly id?: string;
  readonly outcome?: string;
  readonly suppressionReason?: string | null;
}

function insertDecision(raw: Raw, emailMessageId: string, overrides: DecisionOverrides = {}): void {
  raw
    .prepare(
      `INSERT INTO email_auto_file_decision
         (id, email_message_id, auto_file_rule_id, matter_id, outcome, suppression_reason, evidence, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?, '{}', ?)`,
    )
    .run(
      overrides.id ?? "emailAutoFileDecision_a",
      emailMessageId,
      overrides.outcome ?? "staged",
      overrides.suppressionReason ?? null,
      NOW,
    );
}

describe("auto-file rules migration", () => {
  test("the chain applies and creates the rule and decision tables", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const names = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names).toContain("email_auto_file_rule");
    expect(names).toContain("email_auto_file_decision");
  });

  test("email_matter_link gains a nullable auto_file_rule_id — null means a person made the link", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const columns = (
      raw.prepare("PRAGMA table_info(email_matter_link)").all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).filter((column) => column.name === "auto_file_rule_id");
    expect(columns).toHaveLength(1);
    expect(columns[0]?.notnull).toBe(0);
    expect(columns[0]?.dflt_value).toBeNull();
  });

  test("the rule kind set is closed at the database — a fourth kind is rejected", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const matterId = seedMatter(raw, "one0000000000000000");
    insertRule(raw, matterId, { kind: "threadContinuation", matchValue: "emailThread_a" });
    expect(() =>
      insertRule(raw, matterId, { id: "emailAutoFileRule_b", kind: "senderDomain" }),
    ).toThrow();
  });

  test("promotion and state are constrained to their closed sets", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const matterId = seedMatter(raw, "two0000000000000000");
    expect(() => insertRule(raw, matterId, { promotion: "deleteIt" })).toThrow();
    expect(() =>
      insertRule(raw, matterId, { state: "paused", suspendedReason: "member" }),
    ).toThrow();
  });

  test("a suspended rule always says why, and an active one never carries a stale reason", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const matterId = seedMatter(raw, "three00000000000000");
    // Suspended with no reason — refused.
    expect(() => insertRule(raw, matterId, { state: "suspended" })).toThrow();
    // Active carrying a reason — refused.
    expect(() =>
      insertRule(raw, matterId, { state: "active", suspendedReason: "blastBound" }),
    ).toThrow();
    // Suspended with a reason from the closed set — accepted.
    insertRule(raw, matterId, { state: "suspended", suspendedReason: "creatorAccessWithdrawn" });
    // A reason outside the set — refused.
    expect(() =>
      insertRule(raw, matterId, {
        id: "emailAutoFileRule_b",
        matchValue: "other@example.com",
        state: "suspended",
        suspendedReason: "becauseISaidSo",
      }),
    ).toThrow();
  });

  test("the same rule cannot be created twice on one matter", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const matterId = seedMatter(raw, "four000000000000000");
    const otherMatterId = seedMatter(raw, "five000000000000000");
    insertRule(raw, matterId);
    // The same kind and match value on a DIFFERENT matter is a different rule, and allowed.
    insertRule(raw, otherMatterId, { id: "emailAutoFileRule_b" });
    expect(() => insertRule(raw, matterId, { id: "emailAutoFileRule_c" })).toThrow();
  });

  test("a suppressed decision always says why, and a decision that acted never does", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const messageId = seedMessage(raw, "emailMessage_a");
    expect(() => insertDecision(raw, messageId, { outcome: "suppressed" })).toThrow();
    expect(() =>
      insertDecision(raw, messageId, { outcome: "filed", suppressionReason: "ambiguousEvidence" }),
    ).toThrow();
    insertDecision(raw, messageId, {
      outcome: "suppressed",
      suppressionReason: "ambiguousEvidence",
    });
    expect(() =>
      insertDecision(raw, messageId, {
        id: "emailAutoFileDecision_b",
        outcome: "suppressed",
        suppressionReason: "itLookedWrong",
      }),
    ).toThrow();
  });

  test("the decision outcome set is closed", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const messageId = seedMessage(raw, "emailMessage_a");
    expect(() => insertDecision(raw, messageId, { outcome: "deleted" })).toThrow();
  });

  test("the capability seed reaches Admin and Attorney only", () => {
    const { raw } = createMigratedNodeDatabase("per-firm");
    const roleIds = (
      raw
        .prepare("SELECT role_id FROM role_permission WHERE permission = ? ORDER BY role_id")
        .all("emails:manageAutoFileRules") as { role_id: string }[]
    ).map((row) => row.role_id);
    expect(roleIds.toSorted()).toEqual(
      ["role_Gw-zKO8hOHQuNv2bWokMp", "role_gEyJ_YqL1_RI_yDqSa28Y"].toSorted(),
    );
  });
});
