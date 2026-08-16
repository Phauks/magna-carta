import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  createMigratedNodeDatabase,
  type MigratedNodeDatabase,
} from "@magna-carta/database/node-sqlite";
import type { FileId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { NaturalLanguageWriteContext } from "../src/natural-language-audit.ts";
import { NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION } from "../src/natural-language-disclosure.ts";
import {
  acknowledgeDisclosureEffect,
  disableNaturalLanguageSearchEffect,
  enableNaturalLanguageSearchEffect,
  mayFeedMatter,
  setMatterExclusionEffect,
} from "../src/natural-language-enablement.ts";
import {
  naturalLanguageSearchEnabledDefinition,
  readNaturalLanguageSearchEnabled,
} from "../src/natural-language-settings.ts";
import {
  countFeedObjectsPendingSince,
  enumerateFeedObjects,
  markFeedObjectRemovedStatement,
  readDisclosureAcknowledgement,
  readExcludedMatterIds,
  readFeedObjectsForDeletion,
  readMatterNaturalLanguageExcluded,
  readUsageMeterTotals,
  recordDisclosureAcknowledgementStatement,
  recordFeedObjectStatement,
  usageMeterCommitStatements,
} from "../src/natural-language-statements.ts";
import {
  NATURAL_LANGUAGE_FEED_DELETION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC,
} from "../src/natural-language-topics.ts";

// These run against the REAL committed per-firm migration lineage, not a hand-written table. A
// statement that disagrees with the shipped schema fails here rather than on a firm's database.

const ADMINISTRATOR = "usr_0123456789abcdefghijkl" as UserId;
const MATTER = "matter_0123456789abcdefghijkl" as MatterId;
const OTHER_MATTER = "matter_zyxwvutsrqponmlkjihgf" as MatterId;
const FILE = "file_0123456789abcdefghijkl" as FileId;
const OTHER_FILE = "file_zyxwvutsrqponmlkjihgf" as FileId;

let fixture: MigratedNodeDatabase;
let clockValue: string;

function context(): NaturalLanguageWriteContext {
  return { clock: { now: () => clockValue }, actorUserId: ADMINISTRATOR };
}

// A member, a matter, and a file — the minimum the foreign keys on these tables require. Written
// directly because this suite is about the natural-language tables, not about how a matter is
// opened.
function seedMinimumCorpus(): void {
  const at = "2026-01-01T00:00:00.000Z";
  fixture.raw.exec(`
    INSERT INTO member (user_id, display_name, created_at)
      VALUES ('${ADMINISTRATOR}', 'A Member', '${at}');
    INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at)
      VALUES ('${MATTER}', 'A Matter', 'open', '${ADMINISTRATOR}', '${at}', '${at}');
    INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at)
      VALUES ('${OTHER_MATTER}', 'Another Matter', 'open', '${ADMINISTRATOR}', '${at}', '${at}');
    INSERT INTO file (id, matter_id, name, created_at, updated_at)
      VALUES ('${FILE}', '${MATTER}', 'a.pdf', '${at}', '${at}');
    INSERT INTO file (id, matter_id, name, created_at, updated_at)
      VALUES ('${OTHER_FILE}', '${OTHER_MATTER}', 'b.pdf', '${at}', '${at}');
  `);
}

beforeEach(() => {
  fixture = createMigratedNodeDatabase("per-firm");
  clockValue = "2026-08-16T12:00:00.000Z";
  seedMinimumCorpus();
});

describe("turning the feature on", () => {
  it("is refused when the firm has acknowledged nothing", async () => {
    const result = await enableNaturalLanguageSearchEffect(fixture.database, context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("disclosure-not-acknowledged");
    expect(result.currentVersion).toBe(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION);
    // And nothing was written. A refusal that had already flipped the setting would be no refusal.
    expect(await readNaturalLanguageSearchEnabled(fixture.database)).toBe(false);
  });

  it("is refused when the firm acknowledged an older statement", async () => {
    // The mechanism the version column exists for. When the feature gains a capability the statement
    // changes, the stored version stops matching, and the firm is asked again rather than being
    // treated as having consented to something it never read.
    await recordDisclosureAcknowledgementStatement(fixture.database, {
      disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION - 1,
      acknowledgedBy: ADMINISTRATOR,
      now: clockValue,
    }).run();

    const result = await enableNaturalLanguageSearchEffect(fixture.database, context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("disclosure-version-stale");
    expect(result.acknowledgedVersion).toBe(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION - 1);
    expect(await readNaturalLanguageSearchEnabled(fixture.database)).toBe(false);
  });

  it("is a refusal and not a throw", async () => {
    // A firm that has not accepted the statement is an ordinary state to report. A throw here would
    // become an Error ID on an administrator's screen for something they can simply go and do.
    await expect(
      enableNaturalLanguageSearchEffect(fixture.database, context()),
    ).resolves.toMatchObject({ ok: false });
  });

  it("opens the gate and enqueues provisioning in one batch once the current statement is accepted", async () => {
    await commitEffectBatch(
      fixture.database,
      acknowledgeDisclosureEffect(fixture.database, context(), ADMINISTRATOR),
      { now: () => clockValue },
    );
    const acknowledgement = await readDisclosureAcknowledgement(fixture.database);
    expect(acknowledgement?.disclosureVersion).toBe(NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION);
    expect(acknowledgement?.acknowledgedBy).toBe(ADMINISTRATOR);

    const result = await enableNaturalLanguageSearchEffect(fixture.database, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effect.outboxMessages.map((message) => message.topic)).toEqual([
      NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC,
    ]);

    await commitEffectBatch(fixture.database, result.effect, { now: () => clockValue });
    expect(await readNaturalLanguageSearchEnabled(fixture.database)).toBe(true);

    // The setting change, its audit row, and the provisioning message are in ONE transaction. There
    // is no state in which the gate is open with no provisioning in flight.
    const audit = fixture.raw
      .prepare("SELECT event FROM audit_log ORDER BY created_at, id")
      .all() as { event: string }[];
    expect(audit.map((row) => row.event)).toContain("search.natural_language.firm_opted_in");
    const outbox = fixture.raw.prepare("SELECT topic FROM outbox").all() as { topic: string }[];
    expect(outbox.map((row) => row.topic)).toContain(NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC);
  });
});

describe("turning it off", () => {
  it("shuts the gate and enqueues teardown, and is never refused", async () => {
    // A firm withdrawing consent does not need permission. A gate that could get stuck open because
    // a precondition failed is the wrong shape for this.
    await commitEffectBatch(
      fixture.database,
      disableNaturalLanguageSearchEffect(fixture.database, context()),
      { now: () => clockValue },
    );
    expect(await readNaturalLanguageSearchEnabled(fixture.database)).toBe(false);
    const outbox = fixture.raw.prepare("SELECT topic FROM outbox").all() as { topic: string }[];
    expect(outbox.map((row) => row.topic)).toContain(NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC);
  });
});

describe("the matter exclusion flag", () => {
  it("defaults to included, so a firm that opts in gets a search with no invisible gaps", async () => {
    expect(await readMatterNaturalLanguageExcluded(fixture.database, MATTER)).toBe(false);
  });

  it("reads a matter it cannot find as excluded", async () => {
    // Total in the safe direction. The feed writer calls this before writing anything, and the right
    // answer for a matter that is not there is to write nothing.
    expect(
      await readMatterNaturalLanguageExcluded(fixture.database, "matter_nope" as MatterId),
    ).toBe(true);
  });

  it("enqueues deletion of the matter's feed objects when set — not merely a stop on new writes", async () => {
    // An opt-out that only stopped new writes would leave the material that prompted it sitting in
    // the index, which is the opposite of what somebody setting this flag is asking for.
    const effect = setMatterExclusionEffect(fixture.database, context(), MATTER, true);
    expect(effect.outboxMessages).toEqual([
      {
        topic: NATURAL_LANGUAGE_FEED_DELETION_TOPIC,
        payload: { scope: "matter", matterId: MATTER },
      },
    ]);
    await commitEffectBatch(fixture.database, effect, { now: () => clockValue });
    expect(await readMatterNaturalLanguageExcluded(fixture.database, MATTER)).toBe(true);
    expect([...(await readExcludedMatterIds(fixture.database, 10))]).toEqual([MATTER]);
  });

  it("enqueues nothing when cleared", async () => {
    // Clearing it re-admits the matter's documents as they are next committed; there is no backfill
    // message, because the daily re-extraction pass already draws in what was already there.
    const effect = setMatterExclusionEffect(fixture.database, context(), MATTER, false);
    expect(effect.outboxMessages).toEqual([]);
  });
});

describe("both gates together, which is what the feed writer reads", () => {
  it("refuses while the firm gate is shut, however the matter flag stands", async () => {
    expect(await mayFeedMatter(fixture.database, MATTER)).toBe(false);
  });

  it("refuses an excluded matter even with the firm gate open", async () => {
    await commitEffectBatch(
      fixture.database,
      acknowledgeDisclosureEffect(fixture.database, context(), ADMINISTRATOR),
      { now: () => clockValue },
    );
    const enabled = await enableNaturalLanguageSearchEffect(fixture.database, context());
    if (!enabled.ok) throw new Error("expected the gate to open");
    await commitEffectBatch(fixture.database, enabled.effect, { now: () => clockValue });
    await commitEffectBatch(
      fixture.database,
      setMatterExclusionEffect(fixture.database, context(), MATTER, true),
      { now: () => clockValue },
    );

    expect(await mayFeedMatter(fixture.database, MATTER)).toBe(false);
    // The other matter is unaffected: exclusion is per matter and never firm-wide by accident.
    expect(await mayFeedMatter(fixture.database, OTHER_MATTER)).toBe(true);
  });

  it("reads the firm gate through the same total accessor a corrupt row cannot open", async () => {
    fixture.raw.exec(
      `INSERT INTO setting (key, value, updated_at) VALUES ('${naturalLanguageSearchEnabledDefinition.key}', 'not json', '2026-01-01T00:00:00.000Z')`,
    );
    expect(await readFirmSetting(fixture.database, naturalLanguageSearchEnabledDefinition)).toBe(
      false,
    );
  });
});

describe("the feed catalog", () => {
  async function feed(fileId: FileId, matterId: MatterId, version: number, at: string) {
    await recordFeedObjectStatement(fixture.database, {
      fileId,
      version,
      matterId,
      objectKey: `ai-search/${matterId}/${fileId}/${version}.md`,
      byteCount: 100,
      fedAt: at,
    }).run();
  }

  it("converges on one row per document version, so a retried write leaves no second copy", async () => {
    await feed(FILE, MATTER, 1, "2026-08-16T10:00:00.000Z");
    await feed(FILE, MATTER, 1, "2026-08-16T11:00:00.000Z");
    const rows = await enumerateFeedObjects(fixture.database, { kind: "firm" }, 100);
    expect(rows.length).toBe(1);
    expect(rows[0]?.fedAt).toBe("2026-08-16T11:00:00.000Z");
  });

  it("clears a removal timestamp on a re-feed, so a re-fed version is live again", async () => {
    await feed(FILE, MATTER, 1, "2026-08-16T10:00:00.000Z");
    await markFeedObjectRemovedStatement(
      fixture.database,
      FILE,
      1,
      "2026-08-16T10:30:00.000Z",
    ).run();
    await feed(FILE, MATTER, 1, "2026-08-16T11:00:00.000Z");
    const rows = await enumerateFeedObjects(fixture.database, { kind: "firm" }, 100);
    expect(rows[0]?.removedAt).toBeNull();
  });

  it("plans a deletion from the catalog, scoped, and never returns an already-removed row", async () => {
    await feed(FILE, MATTER, 1, "2026-08-16T10:00:00.000Z");
    await feed(OTHER_FILE, OTHER_MATTER, 1, "2026-08-16T10:00:00.000Z");

    const matterPlan = await readFeedObjectsForDeletion(
      fixture.database,
      { kind: "matter", matterId: MATTER },
      100,
    );
    expect(matterPlan.map((row) => row.objectKey)).toEqual([`ai-search/${MATTER}/${FILE}/1.md`]);

    await markFeedObjectRemovedStatement(
      fixture.database,
      FILE,
      1,
      "2026-08-16T11:00:00.000Z",
    ).run();
    expect(
      await readFeedObjectsForDeletion(fixture.database, { kind: "matter", matterId: MATTER }, 100),
    ).toEqual([]);
    // But the ENUMERATION still shows it, with its removal timestamp — which is the half of deletion
    // the platform can demonstrate.
    const enumerated = await enumerateFeedObjects(
      fixture.database,
      { kind: "matter", matterId: MATTER },
      100,
    );
    expect(enumerated[0]?.removedAt).toBe("2026-08-16T11:00:00.000Z");
  });

  it("counts what the managed index has not seen yet, and counts everything when nothing has synced", async () => {
    await feed(FILE, MATTER, 1, "2026-08-16T10:00:00.000Z");
    await feed(OTHER_FILE, OTHER_MATTER, 1, "2026-08-16T12:00:00.000Z");
    expect(await countFeedObjectsPendingSince(fixture.database, null)).toBe(2);
    expect(await countFeedObjectsPendingSince(fixture.database, "2026-08-16T11:00:00.000Z")).toBe(
      1,
    );
    expect(await countFeedObjectsPendingSince(fixture.database, "2026-08-16T13:00:00.000Z")).toBe(
      0,
    );
  });

  it("stops counting a removed object as pending", async () => {
    await feed(FILE, MATTER, 1, "2026-08-16T12:00:00.000Z");
    await markFeedObjectRemovedStatement(
      fixture.database,
      FILE,
      1,
      "2026-08-16T12:30:00.000Z",
    ).run();
    expect(await countFeedObjectsPendingSince(fixture.database, null)).toBe(0);
  });
});

describe("the usage meter", () => {
  it("sums authoritative counts by civil day and keeps the estimate in its own column", async () => {
    for (const statement of usageMeterCommitStatements(fixture.database, {
      day: "2026-08-16",
      semanticQueryCount: 3,
      fedBytes: 1_000,
      estimatedIngestionTokens: 250,
      estimatedIngestionBytesPerToken: 4,
    })) {
      await statement.run();
    }
    for (const statement of usageMeterCommitStatements(fixture.database, {
      day: "2026-08-16",
      fullTextQueryCount: 1,
    })) {
      await statement.run();
    }

    const totals = await readUsageMeterTotals(fixture.database);
    expect(totals.authoritative).toEqual({
      semanticQueryCount: 3,
      fullTextQueryCount: 1,
      fedBytes: 1_000,
    });
    expect(totals.estimated).toEqual({ ingestionTokens: 250 });
  });

  it("reports zero rather than nothing for a firm that has used none of it", async () => {
    const totals = await readUsageMeterTotals(fixture.database);
    expect(totals.authoritative).toEqual({
      semanticQueryCount: 0,
      fullTextQueryCount: 0,
      fedBytes: 0,
    });
    expect(totals.estimated).toEqual({ ingestionTokens: 0 });
  });

  it("keeps the estimate out of the authoritative bag, so a renderer cannot show them alike", async () => {
    // Structural rather than a naming convention: a renderer handed one flat bag has to remember
    // which number is a measurement, and the day it forgets, an estimate is presented as a meter.
    const totals = await readUsageMeterTotals(fixture.database);
    expect(Object.keys(totals.authoritative)).not.toContain("ingestionTokens");
    expect(Object.keys(totals.authoritative).some((key) => key.startsWith("estimated"))).toBe(
      false,
    );
  });

  it("names managed storage as an unmetered gap rather than reporting it as zero", async () => {
    // No per-instance storage figure is available. A zero would read as "this costs nothing", which
    // is a different and false statement from "this platform cannot measure it".
    const totals = await readUsageMeterTotals(fixture.database);
    expect([...totals.notMetered]).toEqual(["managed index storage"]);
  });
});
