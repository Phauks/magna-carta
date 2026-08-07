import { describe, expect, it } from "vitest";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { FactsValidationError } from "../src/facts-grammar.ts";
import {
  comparisonDedupeKey,
  materializeNotification,
  outboxDedupeKey,
} from "../src/materialize.ts";
import type { NotificationType } from "../src/registry.ts";
import { MAX_RECIPIENTS_PER_EVENT } from "../src/types.ts";

function typeFixture(overrides: Partial<NotificationType> = {}): NotificationType {
  return {
    key: "system.matter.closed",
    category: "system",
    severity: "informational",
    mandatory: false,
    audience: "responsible-member",
    includeActor: false,
    subscribesTo: "matter.closed",
    subjectKind: "matter",
    subjectPayloadKey: "matterId",
    matterAnchored: true,
    matterResolution: { kind: "payload", payloadKey: "matterId" },
    facts: {},
    buildFacts: () => ({}),
    escalation: "digest",
    channels: ["in_app", "email"],
    emailContent: "category-count",
    deepLink: (_subjectId, matterId) => `/matters/${matterId ?? ""}/overview`,
    ...overrides,
  };
}

const base = {
  payload: { matterId: "matter_abc123XYZ" },
  subjectId: "matter_abc123XYZ",
  matterId: "matter_abc123XYZ",
  dedupeKey: "matter.closed:outbox_1",
  occurredAt: "2026-08-07T02:00:00.000Z",
  createdAt: "2026-08-07T02:00:00.000Z",
  randomSource: seededRandomSource(7),
};

describe("dedupe keys", () => {
  it("keys the event-driven path on the originating outbox row id", () => {
    // Stable across every redelivery of that message, which is what makes a redelivery a no-op by
    // construction rather than by a check-then-insert with its own race.
    expect(outboxDedupeKey("matter.closed", "outbox_9f")).toBe("matter.closed:outbox_9f");
  });

  it("keys the comparison-driven path on a CIVIL DATE, so a standing condition raises once a day", () => {
    // Without the bucket, an overdue deadline raises every time the sweep runs, forever.
    const monday = comparisonDedupeKey(
      "calendar.deadline.overdue",
      "matterDeadline_x",
      "2026-08-07",
    );
    const tuesday = comparisonDedupeKey(
      "calendar.deadline.overdue",
      "matterDeadline_x",
      "2026-08-08",
    );
    expect(monday).not.toBe(tuesday);
    expect(comparisonDedupeKey("calendar.deadline.overdue", "matterDeadline_x", "2026-08-07")).toBe(
      monday,
    );
  });
});

describe("materializing a notification", () => {
  it("builds the event row and one recipient row per member", () => {
    const result = materializeNotification({
      ...base,
      type: typeFixture(),
      recipientUserIds: ["user_a", "user_b"] as UserId[],
    });
    expect(result.event.kind).toBe("system.matter.closed");
    expect(result.event.matterId).toBe("matter_abc123XYZ");
    expect(result.recipients).toHaveLength(2);
    expect(result.recipients.every((row) => row.notificationEventId === result.event.id)).toBe(
      true,
    );
    expect(result.clampedRecipients).toBe(0);
  });

  it("REFUSES a matter-anchored type whose materializer resolved no matter", () => {
    // Not "unfiltered" — UNFILTERABLE. The wall is a join on this column, so the row would either
    // vanish from every read or appear in all of them depending on how the join were written.
    expect(() =>
      materializeNotification({
        ...base,
        matterId: null,
        type: typeFixture(),
        recipientUserIds: ["user_a"] as UserId[],
      }),
    ).toThrowError(/matter-anchored/);
  });

  it("refuses facts outside the type's own declaration", () => {
    expect(() =>
      materializeNotification({
        ...base,
        type: typeFixture({
          facts: {},
          buildFacts: () => ({ matterTitle: "Ellison v. Braddock" }),
        }),
        recipientUserIds: ["user_a"] as UserId[],
      }),
    ).toThrowError(FactsValidationError);
  });

  it("de-duplicates a resolver that returned the same member twice", () => {
    const result = materializeNotification({
      ...base,
      type: typeFixture(),
      recipientUserIds: ["user_a", "user_a", "user_b"] as UserId[],
    });
    expect(result.recipients).toHaveLength(2);
    expect(result.clampedRecipients).toBe(0);
  });

  it("caps the fan-out and REPORTS the clamp rather than swallowing it", () => {
    // A fan-out larger than a firm's staff means a resolver bug. The cap turns that into a metric
    // instead of a mail storm — but only if the clamp is counted.
    const many = Array.from(
      { length: MAX_RECIPIENTS_PER_EVENT + 5 },
      (_, index) => `user_${index}`,
    ) as UserId[];
    const result = materializeNotification({
      ...base,
      type: typeFixture(),
      recipientUserIds: many,
    });
    expect(result.recipients).toHaveLength(MAX_RECIPIENTS_PER_EVENT);
    expect(result.clampedRecipients).toBe(5);
  });

  it("carries a firm-scoped type with a null anchor", () => {
    const result = materializeNotification({
      ...base,
      matterId: null,
      subjectId: "incident_abc123XYZ",
      type: typeFixture({
        key: "system.incident.created",
        subjectKind: "incident",
        subjectPayloadKey: "incidentId",
        matterAnchored: false,
        matterResolution: { kind: "none" },
        facts: { errorIdCount: { kind: "integer" } },
        buildFacts: () => ({ errorIdCount: 3 }),
      }),
      recipientUserIds: ["user_admin"] as UserId[],
    });
    expect(result.event.matterId).toBeNull();
    expect(result.event.facts).toEqual({ errorIdCount: 3 });
  });
});
