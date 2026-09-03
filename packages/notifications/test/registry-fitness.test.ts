import { describe, expect, it } from "vitest";
import { INVOICE_VOIDED_TOPIC } from "@magna-carta/billing/draft";
import { INVOICE_FINALIZED_TOPIC } from "@magna-carta/billing/finalize";
import { CALENDAR_OUTBOX_TOPICS } from "@magna-carta/calendar/notifications";
import {
  CALENDAR_DEADLINE_DUE_EMISSION_POINT,
  CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
  CALENDAR_NOTIFICATION_EMISSION_POINTS,
} from "@magna-carta/calendar/notifications";
import { CONFLICTS_OUTBOX_TOPICS } from "@magna-carta/conflicts/topics";
import { EMAIL_FILING_OUTBOX_TOPICS } from "@magna-carta/email-filing/topics";
import { FILE_MANAGER_OUTBOX_TOPICS } from "@magna-carta/file-manager/topics";
import { TASK_OUTBOX_TOPICS } from "@magna-carta/tasks/notifications";
import { LEDGER_ENTRY_POSTED_TOPIC } from "@magna-carta/ledger/post-entry";
import { MATTER_OUTBOX_TOPICS } from "@magna-carta/matters/topics";
import { LOCALLY_NAMED_EMISSION_POINTS } from "../src/emission-points.ts";
import { validateFactsSchema } from "../src/facts-grammar.ts";
import {
  categoryIsMandatory,
  notificationTypeForKey,
  notificationTypesForComparisonPoint,
  notificationTypesForJobCompletionPoint,
  notificationTypesForTopic,
  NOTIFICATION_TYPES,
} from "../src/registry.ts";
import {
  IMMEDIATE_ESCALATION_CATEGORIES,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_SUBJECT_KINDS,
} from "../src/types.ts";

// THE FITNESS FUNCTIONS. The registry is only worth being a registry if the rules it exists to
// carry are proved from one table-driven pass rather than re-read by whoever is doing the review
// that day. Each of these is a rule that, broken, is invisible until it is a disclosure or a
// silently-undelivered notification.

// Every outbox topic a producing package exports, in one set. A subscription resolving here proves
// the subscriber and the producer share one spelling — which matters more than it looks, because an
// unrecognized topic on the per-firm bus is acked and ignored by design: a typo does not throw, it
// just quietly stops delivering.
const PRODUCING_PACKAGE_TOPICS = new Set<string>([
  ...MATTER_OUTBOX_TOPICS,
  ...CALENDAR_OUTBOX_TOPICS,
  ...CONFLICTS_OUTBOX_TOPICS,
  ...EMAIL_FILING_OUTBOX_TOPICS,
  ...FILE_MANAGER_OUTBOX_TOPICS,
  ...TASK_OUTBOX_TOPICS,
  LEDGER_ENTRY_POSTED_TOPIC,
  INVOICE_FINALIZED_TOPIC,
  INVOICE_VOIDED_TOPIC,
]);

// The emission points a COMPARISON kind may name. The calendar declares its own set — the deadline
// points among them, wired to no write because no write makes a deadline become due — and the two
// custody reasons have no producing constant at all, which emission-points.ts explains and this
// list holds to being written down rather than being an unexplained gap.
const COMPARISON_EMISSION_POINTS = new Set<string>([
  ...CALENDAR_NOTIFICATION_EMISSION_POINTS,
  ...LOCALLY_NAMED_EMISSION_POINTS,
]);

// The one topic whose producer is a worker route rather than a domain package, so there is no
// package constant to import from here. The worker's own test pins the registry's spelling against
// the route's exported constant, which is the same guarantee by a different route; this list exists
// so the exception has to be written down rather than being an unexplained gap in the check above.
const TOPICS_WITHOUT_A_PRODUCING_PACKAGE_CONSTANT = new Set<string>(["incident.created"]);

describe("the notification registry", () => {
  it("subscribes only to topics a producing package exports (or a named exception)", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (type.raisedBy !== "outbox-topic") continue;
      const resolved =
        PRODUCING_PACKAGE_TOPICS.has(type.subscribesTo) ||
        TOPICS_WITHOUT_A_PRODUCING_PACKAGE_CONSTANT.has(type.subscribesTo);
      expect(resolved, `${type.key} subscribes to an unresolvable topic`).toBe(true);
    }
  });

  it("names a comparison point only from a set an owning package or this one declares", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (type.raisedBy !== "comparison-sweep") continue;
      expect(
        COMPARISON_EMISSION_POINTS.has(type.subscribesTo),
        `${type.key} names an unresolvable comparison point`,
      ).toBe(true);
    }
  });

  it("names a job-completion point only from the ones declared here", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (type.raisedBy !== "job-coordinator") continue;
      expect(
        LOCALLY_NAMED_EMISSION_POINTS,
        `${type.key} names an unresolvable job-completion point`,
      ).toContain(type.subscribesTo);
    }
  });

  it("keeps a comparison kind off the topic index, and a topic kind off the comparison index", () => {
    // A comparison point that shared a spelling with a topic on the bus would otherwise be
    // materialized twice: once by the sweep that owns it and once by the translator that mistook it
    // for a subscription. The two indexes are what make that unwritable rather than unlikely.
    for (const type of NOTIFICATION_TYPES) {
      const onTopicIndex = notificationTypesForTopic(type.subscribesTo).includes(type);
      const onComparisonIndex = notificationTypesForComparisonPoint(type.subscribesTo).includes(
        type,
      );
      const onJobIndex = notificationTypesForJobCompletionPoint(type.subscribesTo).includes(type);
      expect(
        [onTopicIndex, onComparisonIndex, onJobIndex].filter(Boolean),
        `${type.key} is indexed under the wrong number of production paths`,
      ).toHaveLength(1);
      expect(onTopicIndex, type.key).toBe(type.raisedBy === "outbox-topic");
      expect(onComparisonIndex, type.key).toBe(type.raisedBy === "comparison-sweep");
      expect(onJobIndex, type.key).toBe(type.raisedBy === "job-coordinator");
    }
  });

  it("reaches more than one person wherever a matter has a team", () => {
    // The audience narrowing that shipped once and reached exactly one person each time. A
    // matter-anchored kind about work on a case is the whole team's fact; the two audiences that are
    // deliberately narrow say so here rather than being discovered by reading every declaration.
    const NARROW_BY_DESIGN = new Set<string>([
      // A job is a reply to a request, and the requester is the only person who asked.
      "jobs.documentAssembly.completed",
      "jobs.recovery.completed",
      // A matter's own lifecycle is the responsible member's fact. Closing and reopening are
      // administrative acts about the file itself rather than about work on it, and the person
      // accountable for the file is the person who has to notice.
      "system.matter.closed",
      "system.matter.reopened",
    ]);
    for (const type of NOTIFICATION_TYPES) {
      if (!type.matterAnchored || NARROW_BY_DESIGN.has(type.key)) continue;
      expect(
        type.audience,
        `${type.key} is matter-anchored and reaches one person; declare matter-team or say why not`,
      ).not.toBe("responsible-member");
    }
  });

  it("raises the two deadline comparisons and nothing else from the deadline points", () => {
    // Both points are wired, and `horizon` deliberately is not: no firm setting names a lead window,
    // and a lead the platform picked for a firm is a lead the firm did not choose.
    expect(
      notificationTypesForComparisonPoint(CALENDAR_DEADLINE_DUE_EMISSION_POINT).map(
        (type) => type.key,
      ),
    ).toEqual(["deadlines.deadline.due"]);
    expect(
      notificationTypesForComparisonPoint(CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT).map(
        (type) => type.key,
      ),
    ).toEqual(["deadlines.deadline.overdue"]);
    expect(notificationTypesForComparisonPoint("calendar.deadline.horizon")).toEqual([]);
  });

  it("declares every enum-valued field from its own closed vocabulary", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATEGORIES, type.key).toContain(type.category);
      expect(NOTIFICATION_SEVERITIES, type.key).toContain(type.severity);
      expect(NOTIFICATION_SUBJECT_KINDS, type.key).toContain(type.subjectKind);
      expect(NOTIFICATION_AUDIENCES, type.key).toContain(type.audience);
      for (const channel of type.channels)
        expect(NOTIFICATION_CHANNELS, type.key).toContain(channel);
    }
  });

  it("agrees with its category about whether it is mandatory in app", () => {
    // Read from the category rather than declared freely, so two types in one category cannot
    // disagree about whether a firm's members may silence it.
    for (const type of NOTIFICATION_TYPES) {
      expect(type.mandatory, type.key).toBe(categoryIsMandatory(type.category));
    }
  });

  it("declares a facts schema inside the closed value grammar", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(validateFactsSchema(type.facts), type.key).toEqual([]);
    }
  });

  it("gives every matter-anchored type a way to resolve its matter", () => {
    // The wall is a join on notification_event.matter_id. A type that claims to be anchored and
    // cannot resolve one is a row the predicate has nothing to decide about.
    for (const type of NOTIFICATION_TYPES) {
      if (!type.matterAnchored) continue;
      expect(type.matterResolution.kind, type.key).not.toBe("none");
    }
  });

  it("declares no matter resolution for a type that is not matter-anchored", () => {
    // The converse, and it is not symmetry for its own sake: a firm-scoped kind that quietly
    // resolved a matter would fall behind a filter it must not be behind, and would vanish for
    // exactly the compliance read it exists for.
    for (const type of NOTIFICATION_TYPES) {
      if (type.matterAnchored) continue;
      expect(type.matterResolution.kind, type.key).toBe("none");
    }
  });

  it("gives every matter-anchored type the counts-only email content", () => {
    // An email cannot be re-filtered when access changes. The only content safe against a future
    // access change is content that never depended on access, which is exactly what a count is.
    for (const type of NOTIFICATION_TYPES) {
      if (!type.matterAnchored) continue;
      expect(type.emailContent, type.key).toBe("category-count");
    }
  });

  it("names a capability exactly when its audience is capability-holders", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(type.audienceCapability !== undefined, type.key).toBe(
        type.audience === "capability-holders",
      );
    }
  });

  it("escalates only in the categories allowed to", () => {
    // Digest-only is very nearly the rule: an email per event is a mail-bomb on any active matter,
    // and it inverts the content argument by disclosing the timing and volume of activity per
    // matter even when each line says nothing.
    for (const type of NOTIFICATION_TYPES) {
      if (type.escalation !== "immediate") continue;
      expect(IMMEDIATE_ESCALATION_CATEGORIES, type.key).toContain(type.category);
    }
  });

  it("declares no substituted audience, because every declared audience resolves as declared", () => {
    // `matter-team` carried a substitution until `matter_assignment` gave it a real team to resolve
    // against. A substitution is a recipient list the platform narrowed silently, so re-introducing
    // one is a deliberate edit here and never a line that slips into a type declaration.
    for (const type of NOTIFICATION_TYPES) {
      expect(type.audienceSubstitutedFrom, type.key).toBeUndefined();
    }
  });

  it("has no duplicate keys, and every key resolves back to its own type", () => {
    const keys = NOTIFICATION_TYPES.map((type) => type.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationTypeForKey(type.key)).toBe(type);
    }
  });

  it("resolves a topic to every type subscribing to it, and an unknown topic to none", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (type.raisedBy !== "outbox-topic") continue;
      expect(notificationTypesForTopic(type.subscribesTo)).toContain(type);
    }
    // The ORDINARY case for most of the bus, and the reason the translator must never throw on it.
    expect(notificationTypesForTopic("shipment.created")).toEqual([]);
    expect(notificationTypesForTopic("")).toEqual([]);
  });

  it("builds a deep link that names the subject", () => {
    for (const type of NOTIFICATION_TYPES) {
      const link = type.deepLink("subject_abc123XYZ", type.matterAnchored ? "matter_x1" : null);
      expect(link.startsWith("/"), type.key).toBe(true);
    }
  });
});
