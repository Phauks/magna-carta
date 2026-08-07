import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { writeScopedSettingStatement } from "@magna-carta/data-access/scoped-setting-statements";
import { z } from "zod";
import {
  DEFAULT_EMAIL_DETAIL_LEVEL,
  EMAIL_DETAIL_LEVEL_KEY,
  notificationRetentionDaysDefinition,
  readNotificationRetentionDays,
  resolveEmailDetailLevel,
  writeNotificationRetentionDaysStatement,
} from "../src/settings.ts";
import {
  DEFAULT_RETENTION_DAYS,
  EMAIL_DETAIL_LEVELS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  moreCautiousEmailDetailLevel,
} from "../src/types.ts";

const NOW = "2026-08-07T02:00:00.000Z";

// The scoped-setting write helper needs a definition; the detail level is read through a purpose
// built two-tier resolver rather than the generic one, so the test writes through the generic
// helper with a matching schema — which is exactly how a preference route would.
const detailLevelDefinition = {
  key: EMAIL_DETAIL_LEVEL_KEY,
  schema: z.enum(EMAIL_DETAIL_LEVELS),
  defaultValue: DEFAULT_EMAIL_DETAIL_LEVEL,
};

function database() {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("the retention window", () => {
  it("defaults to ninety days with nothing stored", async () => {
    expect(await readNotificationRetentionDays(database())).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("honours a firm's setting inside the declared bounds", async () => {
    const firmDatabase = database();
    await writeNotificationRetentionDaysStatement(firmDatabase, 180, NOW).run();
    expect(await readNotificationRetentionDays(firmDatabase)).toBe(180);
  });

  it("refuses a window outside the bounds at the WRITE, loudly", () => {
    // Below thirty days a member back from two weeks' leave opens an empty feed; above a year the
    // feed is an unbounded read and every extra day is another day a pointer outlives the access
    // check that justified it.
    const firmDatabase = database();
    expect(() =>
      writeNotificationRetentionDaysStatement(firmDatabase, MIN_RETENTION_DAYS - 1, NOW),
    ).toThrow();
    expect(() =>
      writeNotificationRetentionDaysStatement(firmDatabase, MAX_RETENTION_DAYS + 1, NOW),
    ).toThrow();
    expect(() => writeNotificationRetentionDaysStatement(firmDatabase, 90.5, NOW)).toThrow();
  });

  it("falls back to the default rather than bricking the read on a corrupt stored value", async () => {
    const firmDatabase = database();
    await firmDatabase
      .prepare("INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3)")
      .bind(notificationRetentionDaysDefinition.key, "not json", NOW)
      .run();
    expect(await readNotificationRetentionDays(firmDatabase)).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("the email detail level — a member's choice under a firm's ceiling", () => {
  it("orders the levels most private first, which is what the composition rests on", () => {
    expect(moreCautiousEmailDetailLevel("off", "matter-number")).toBe("off");
    expect(moreCautiousEmailDetailLevel("matter-number", "counts-only")).toBe("counts-only");
    expect(moreCautiousEmailDetailLevel("counts-only", "counts-only")).toBe("counts-only");
  });

  it("defaults both tiers to counts-only", async () => {
    const resolved = await resolveEmailDetailLevel(database(), "user_a");
    expect(resolved).toEqual({
      firmCeiling: "counts-only",
      memberChoice: null,
      effective: "counts-only",
    });
  });

  it("lets a member choose MORE private than the firm's ceiling", async () => {
    const firmDatabase = database();
    await writeScopedSettingStatement(
      firmDatabase,
      detailLevelDefinition,
      "firm",
      null,
      "matter-number",
      NOW,
    ).run();
    await writeScopedSettingStatement(
      firmDatabase,
      detailLevelDefinition,
      "user",
      "user_a",
      "off",
      NOW,
    ).run();
    const resolved = await resolveEmailDetailLevel(firmDatabase, "user_a");
    expect(resolved.firmCeiling).toBe("matter-number");
    expect(resolved.memberChoice).toBe("off");
    expect(resolved.effective).toBe("off");
  });

  it("never lets a member choose LESS private than the firm's ceiling", async () => {
    // The asymmetry is the whole point. A firm has a legitimate interest in capping what leaves its
    // platform into a mailbox it may not administer; a member asking for more is asking the firm to
    // put more of a client into that mailbox than the firm decided to.
    const firmDatabase = database();
    await writeScopedSettingStatement(
      firmDatabase,
      detailLevelDefinition,
      "firm",
      null,
      "off",
      NOW,
    ).run();
    await writeScopedSettingStatement(
      firmDatabase,
      detailLevelDefinition,
      "user",
      "user_a",
      "matter-number",
      NOW,
    ).run();
    const resolved = await resolveEmailDetailLevel(firmDatabase, "user_a");
    expect(resolved.firmCeiling).toBe("off");
    expect(resolved.memberChoice).toBe("matter-number");
    expect(resolved.effective).toBe("off");
  });

  it("reads only the asking member's tier, never another member's", async () => {
    const firmDatabase = database();
    await writeScopedSettingStatement(
      firmDatabase,
      detailLevelDefinition,
      "user",
      "user_other",
      "off",
      NOW,
    ).run();
    const resolved = await resolveEmailDetailLevel(firmDatabase, "user_a");
    expect(resolved.memberChoice).toBeNull();
    expect(resolved.effective).toBe("counts-only");
  });
});
