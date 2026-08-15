import { linkMatterParty } from "@magna-carta/directory/party";
import { createPerson } from "@magna-carta/directory/person";
import {
  DIRECTORY_ENTITY_MERGED_TOPIC,
  DIRECTORY_ENTITY_RENAMED_TOPIC,
} from "@magna-carta/directory/topics";
import { expect, test } from "vitest";
import { readMatterConflictsPosture } from "../src/posture.ts";
import { recordRecheckRequests } from "../src/recheck-request.ts";
import { satisfyRecheckRequestsForMatter } from "../src/recheck-run.ts";
import { countOpenRecheckRequests } from "../src/recheck-statements.ts";
import { CONFLICTS_HIT_SURFACED_TOPIC } from "../src/topics.ts";
import { recheckFixture, type RecheckFixture } from "./support/recheck-fixture.ts";

// THE DRAIN: several accumulated causes collapse into ONE check that names them all, the interval
// each cause waited is preserved, and a matter with nothing open produces no check at all.

const OCCURRED_EARLY = "2026-08-13T07:00:00.000Z";
const OCCURRED_LATE = "2026-08-13T08:00:00.000Z";

async function request(
  fixture: RecheckFixture,
  matterId: string,
  causeTopic: string,
  causeReference: string,
  causeOccurredAt: string,
): Promise<void> {
  await recordRecheckRequests(
    fixture.database,
    {
      causeTopic,
      causeReference,
      causeOccurredAt,
      matterIds: [matterId],
      maxMattersPerEvent: 50,
    },
    { now: fixture.clock.now, randomSource: fixture.randomSource },
  );
}

interface StoredCheck {
  readonly id: string;
  readonly trigger: string;
  readonly trigger_source: string | null;
  readonly cause_json: string | null;
  readonly actor_user_id: string | null;
}

async function storedChecks(fixture: RecheckFixture): Promise<StoredCheck[]> {
  const { results } = await fixture.database
    .prepare(
      "SELECT id, trigger, trigger_source, cause_json, actor_user_id FROM conflicts_check ORDER BY created_at ASC",
    )
    .all<StoredCheck>();
  return results;
}

test("two causes accumulating for one matter produce ONE check that names both", async () => {
  const fixture = await recheckFixture("coalesce");
  fixture.addMatter("matter_one");
  const entityId = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_one", entityId, role: "client" },
    fixture.writeOptions,
  );
  await request(
    fixture,
    "matter_one",
    DIRECTORY_ENTITY_MERGED_TOPIC,
    "directoryPerson_gone",
    OCCURRED_EARLY,
  );
  await request(fixture, "matter_one", DIRECTORY_ENTITY_RENAMED_TOPIC, entityId, OCCURRED_LATE);

  const outcome = await satisfyRecheckRequestsForMatter(
    fixture.context,
    "matter_one",
    fixture.writeOptions,
  );

  expect(outcome.causesSatisfied).toBe(2);
  const checks = await storedChecks(fixture);
  expect(checks).toHaveLength(1);
  // Coalescing collapses causes into ONE check, never out of existence: both are named on the row.
  const causes = JSON.parse(checks[0]!.cause_json ?? "[]") as Array<{ topic: string }>;
  expect(causes.map((cause) => cause.topic).toSorted()).toEqual([
    DIRECTORY_ENTITY_MERGED_TOPIC,
    DIRECTORY_ENTITY_RENAMED_TOPIC,
  ]);
  // The oldest cause names the trigger — it is the change that has been waiting longest, and letting
  // a trivial later cause relabel it would understate what the check was answering.
  expect(checks[0]!.trigger).toBe("entity_merged");
  expect(checks[0]!.trigger_source).toBe("event");
  // Nobody asked for this run, so nobody is credited with it.
  expect(checks[0]!.actor_user_id).toBeNull();
  expect(await countOpenRecheckRequests(fixture.database)).toBe(0);
});

test("a redelivered drain signal writes no second check", async () => {
  const fixture = await recheckFixture("redelivery");
  fixture.addMatter("matter_one");
  await request(
    fixture,
    "matter_one",
    DIRECTORY_ENTITY_MERGED_TOPIC,
    "directoryPerson_gone",
    OCCURRED_EARLY,
  );

  await satisfyRecheckRequestsForMatter(fixture.context, "matter_one", fixture.writeOptions);
  const second = await satisfyRecheckRequestsForMatter(
    fixture.context,
    "matter_one",
    fixture.writeOptions,
  );

  expect(second.checkId).toBeNull();
  expect(await storedChecks(fixture)).toHaveLength(1);
});

test("a matter with nothing open produces no check", async () => {
  const fixture = await recheckFixture("nothing-open");
  fixture.addMatter("matter_one");
  const outcome = await satisfyRecheckRequestsForMatter(
    fixture.context,
    "matter_one",
    fixture.writeOptions,
  );
  expect(outcome.checkId).toBeNull();
  expect(await storedChecks(fixture)).toHaveLength(0);
});

test("an unsatisfied request is reported by the posture read, naming its cause and when it happened", async () => {
  const fixture = await recheckFixture("posture-pending");
  fixture.addMatter("matter_one");
  await request(
    fixture,
    "matter_one",
    DIRECTORY_ENTITY_MERGED_TOPIC,
    "directoryPerson_gone",
    OCCURRED_EARLY,
  );

  const before = await readMatterConflictsPosture(fixture.database, "matter_one");
  // A matter nobody has ever checked can still be owed a re-check, and that is exactly the case that
  // most needs saying — reporting nothing pending because there is no check would hide it.
  expect(before.neverChecked).toBe(true);
  expect(before.pendingRecheck).toEqual([
    {
      causeTopic: DIRECTORY_ENTITY_MERGED_TOPIC,
      causeReference: "directoryPerson_gone",
      causeOccurredAt: OCCURRED_EARLY,
      requestedAt: fixture.clock.now(),
    },
  ]);
  // The clock-driven backstop's standing is part of the report: a firm that switched it off has made
  // a choice about its own procedure, and it is invisible unless the report says so.
  expect(before.periodicRescan).toEqual({ enabled: true, intervalDays: 7, lastRunAt: null });

  await satisfyRecheckRequestsForMatter(fixture.context, "matter_one", fixture.writeOptions);
  const after = await readMatterConflictsPosture(fixture.database, "matter_one");
  expect(after.pendingRecheck).toEqual([]);
  expect(after.neverChecked).toBe(false);
});

test("a run that surfaces nothing announces nothing", async () => {
  // A notification for a search that found nothing would train a firm to ignore the channel by the
  // time one that found something arrives.
  const fixture = await recheckFixture("quiet");
  fixture.addMatter("matter_one");
  await request(
    fixture,
    "matter_one",
    DIRECTORY_ENTITY_MERGED_TOPIC,
    "directoryPerson_gone",
    OCCURRED_EARLY,
  );
  await satisfyRecheckRequestsForMatter(fixture.context, "matter_one", fixture.writeOptions);

  const { results } = await fixture.database
    .prepare("SELECT COUNT(*) AS total FROM outbox WHERE topic = ?1")
    .bind(CONFLICTS_HIT_SURFACED_TOPIC)
    .all<{ total: number }>();
  expect(results[0]?.total).toBe(0);
});

test("an automated run that surfaces a hit announces counts and nothing else", async () => {
  const fixture = await recheckFixture("announce");
  fixture.addMatter("matter_one");
  fixture.addMatter("matter_other");
  // Two entities with the same name, one on each matter: the check on matter_one surfaces the other
  // as a candidate at the exact-name tier.
  const subject = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  const twin = await createPerson(
    fixture.database,
    { given: "Ada", family: "Byron" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_one", entityId: subject, role: "client" },
    fixture.writeOptions,
  );
  await linkMatterParty(
    fixture.database,
    { matterId: "matter_other", entityId: twin, role: "opposing_party" },
    fixture.writeOptions,
  );
  await request(fixture, "matter_one", DIRECTORY_ENTITY_RENAMED_TOPIC, subject, OCCURRED_EARLY);

  await satisfyRecheckRequestsForMatter(fixture.context, "matter_one", fixture.writeOptions);

  const { results } = await fixture.database
    .prepare("SELECT payload FROM outbox WHERE topic = ?1")
    .bind(CONFLICTS_HIT_SURFACED_TOPIC)
    .all<{ payload: string }>();
  expect(results).toHaveLength(1);
  const payload = JSON.parse(results[0]!.payload) as Record<string, unknown>;
  expect(payload["matterId"]).toBe("matter_one");
  expect(typeof payload["hitCount"]).toBe("number");
  expect(payload["hitCount"]).toBeGreaterThan(0);
  // Counts and handles only. A name that surfaced in a conflicts search is the most sensitive thing
  // this platform holds about who a firm is talking to, and a notification row outlives the access
  // check that justified it.
  expect(results[0]!.payload).not.toContain("Byron");
  expect(results[0]!.payload).not.toContain("Ada");
});
