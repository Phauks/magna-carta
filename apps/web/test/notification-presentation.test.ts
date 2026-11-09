import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_PRESENTATION,
  PRESENTED_KINDS,
  SEVERITY_BADGE,
  PRIORITY_LABEL,
  describeNotification,
} from "$lib/notifications/notification-presentation.ts";
import { NOTIFICATION_CATEGORIES } from "$lib/notifications/category-vocabulary.ts";
import type { NotificationItem } from "$lib/notifications/notifications-api.ts";

/*
 * The pairing between the platform's notification registry and the words this client puts on its
 * rows — the same scan the timeline registry gets, for the same reason and in the same direction.
 *
 * A notification row carries no sentence: the server sends a kind, closed labels, counts and dates,
 * and the card is composed here. That leaves exactly one way for the two halves to drift — a type
 * is registered on the server, nothing here knows its kind, and it reaches a member's screen with
 * no words of its own. The SERVER is the authority, so every kind it registers must be answered
 * here; the reverse is not an error, because a kind can be retired while readers still hold rows
 * pointing at it and those rows must keep rendering.
 *
 * The registry is read as TEXT rather than imported. apps/web does not depend on
 * @magna-carta/notifications and should not start: the package reaches the firm database, the
 * data-access layer and half a dozen producing packages, none of which belong in a browser bundle's
 * dependency graph for the sake of a list of strings.
 */

const REGISTRY_FILE = fileURLToPath(
  new URL("../../../packages/notifications/src/registry.ts", import.meta.url),
);

function registeredKinds(): readonly string[] {
  const source = readFileSync(REGISTRY_FILE, "utf8");
  return [...source.matchAll(/^\s+key: "([^"]+)",$/gm)].map((match) => match[1] ?? "");
}

function itemOf(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "notificationRecipient_x",
    kind: "system.matter.closed",
    category: "system",
    severity: "informational",
    state: "unread",
    subjectKind: "matter",
    subjectId: "matter_x",
    matterId: "matter_x",
    matterNumber: "2026-0001",
    occurredAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    facts: null,
    link: "/matters/matter_x",
    ...overrides,
  };
}

describe("the notification presentation registry", () => {
  it("reads the server's registry at all", () => {
    // The scan below is worthless if the pattern silently matches nothing, which is what happens
    // the day the registry is reformatted. Anchor it on a count rather than trusting the regex.
    expect(registeredKinds().length).toBeGreaterThan(20);
  });

  it("has words for every kind the platform registers", () => {
    const missing = registeredKinds().filter((kind) => !PRESENTED_KINDS.includes(kind));
    expect(missing).toEqual([]);
  });

  it("gives every category the two things a FEED adds to its name", () => {
    // The name and the one line are the vocabulary's, pinned by
    // apps/web/test/notification-category-vocabulary.test.ts against the contract. What this module
    // owns is the glyph and the fallback noun, so those are what this asserts — re-checking the
    // labels here would be a second opinion about a fact with one home.
    for (const category of NOTIFICATION_CATEGORIES) {
      const presentation = CATEGORY_PRESENTATION[category];
      expect(presentation.icon, `${category} has a glyph`).toBeDefined();
      expect(presentation.noun.length, `${category} has a fallback noun`).toBeGreaterThan(0);
    }
  });

  it("gives a kind it has never heard of a real row rather than a blank", () => {
    // A client that shipped before a type did must not swallow the row: something needed the
    // member's attention, and the deep link behind it still resolves.
    const described = describeNotification(
      itemOf({ kind: "trust.something.new", category: "trust" }),
    );
    expect(described.fallback).toBe(true);
    expect(described.title).toContain("trust movement");
    expect(described.title).not.toContain("trust.something.new");
  });

  it("states the facts a kind declares, and stays silent where it declares none", () => {
    expect(
      describeNotification(
        itemOf({
          kind: "deadlines.deadline.overdue",
          category: "deadlines",
          facts: { daysOverdue: 3 },
        }),
      ).detail,
    ).toBe("3 days overdue");
    // Singular, because "1 days overdue" is the tell that nobody read the output.
    expect(
      describeNotification(
        itemOf({
          kind: "deadlines.deadline.overdue",
          category: "deadlines",
          facts: { daysOverdue: 1 },
        }),
      ).detail,
    ).toBe("1 day overdue");
    // Zero is not "0 days overdue" — the sweep raises on the civil day it falls.
    expect(
      describeNotification(
        itemOf({
          kind: "deadlines.deadline.overdue",
          category: "deadlines",
          facts: { daysOverdue: 0 },
        }),
      ).detail,
    ).toBe("Due today");
    expect(describeNotification(itemOf({ kind: "system.matter.closed" })).detail).toBeNull();
  });

  it("survives facts that are absent or the wrong shape", () => {
    // The row is written by a producer this client does not control and outlives the deploy that
    // wrote it. A missing fact renders one line shorter; it never renders "undefined".
    const described = describeNotification(
      itemOf({ kind: "conflicts.hit.surfaced", category: "conflicts", facts: null }),
    );
    expect(described.detail).toBeNull();
    expect(described.title.length).toBeGreaterThan(0);
  });

  it("separates a strong conflicts hit from an ordinary one", () => {
    expect(
      describeNotification(
        itemOf({
          kind: "conflicts.hit.surfaced",
          category: "conflicts",
          facts: { hitCount: 4, strongHitCount: 2 },
        }),
      ).detail,
    ).toBe("4 matches, 2 exact");
    expect(
      describeNotification(
        itemOf({
          kind: "conflicts.hit.surfaced",
          category: "conflicts",
          facts: { hitCount: 1, strongHitCount: 0 },
        }),
      ).detail,
    ).toBe("1 match");
  });

  it("keeps `attention` off the danger tint", () => {
    // A feed whose ordinary case is red is a feed nobody reads twice.
    expect(SEVERITY_BADGE.attention).toBe("warning");
    expect(SEVERITY_BADGE.critical).toBe("danger");
    expect(PRIORITY_LABEL.critical).toBe("Urgent");
  });

  it("gives an informational notification no priority word at all", () => {
    // The owner's ruling: a priority shows only where one actually occurs.
    expect(PRIORITY_LABEL.informational).toBeNull();
  });

  it("never says an email was filed", () => {
    // Filed means filed with a court; an email arriving on a matter is saved to it.
    expect(describeNotification(itemOf({ kind: "email.filed", category: "email" })).title).toBe(
      "Email saved to a matter",
    );
  });
});
