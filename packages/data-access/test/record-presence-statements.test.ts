import { getTableConfig } from "drizzle-orm/sqlite-core";
import { recordPresence } from "@magna-carta/database/per-firm-schema";
import type { UserId } from "@magna-carta/identifiers/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { BatchDatabase } from "../src/effect-batch.ts";
import {
  RECORD_PRESENCE_TABLE,
  leaveRecordPresence,
  readRecordPresence,
  touchRecordPresence,
} from "../src/record-presence-statements.ts";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";

// Who else is here, over the real per-firm schema: a member sees the others on the same record and
// never themselves, someone who stopped touching drops out after the window, a leave takes them out
// at once, and a touch clears the record's rows older than an hour.

const RECONCILIATION = { recordKind: "trust_bank_reconciliation", recordId: "tbr_one" };
const OTHER_RECORD = { recordKind: "trust_bank_reconciliation", recordId: "tbr_two" };
const ANA = "user_ana" as UserId;
const BEN = "user_ben" as UserId;
const CAL = "user_cal" as UserId;

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 10, 20, 12, 0, seconds)).toISOString();

let database: BatchDatabase;

beforeEach(async () => {
  database = await freshFirmDatabase();
  for (const [userId, name] of [
    [ANA, "Ana Reyes"],
    [BEN, "Ben Ortiz"],
    [CAL, "Cal Moore"],
  ] as const) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)",
      )
      .bind(userId, name, at(0))
      .run();
  }
});

describe("record presence", () => {
  it("names its table as the schema does", () => {
    expect(getTableConfig(recordPresence).name).toBe(RECORD_PRESENCE_TABLE);
  });

  it("shows the others on the same record, never the member asking", async () => {
    await touchRecordPresence(database, RECONCILIATION, ANA, at(0));
    await touchRecordPresence(database, OTHER_RECORD, CAL, at(1));
    const others = await touchRecordPresence(database, RECONCILIATION, BEN, at(2));
    expect(others.map((member) => member.displayName)).toEqual(["Ana Reyes"]);
    const forAna = await readRecordPresence(database, RECONCILIATION, ANA, at(3));
    expect(forAna.map((member) => member.userId)).toEqual([BEN]);
  });

  it("drops someone who stopped touching once the window passes", async () => {
    await touchRecordPresence(database, RECONCILIATION, ANA, at(0));
    expect(await readRecordPresence(database, RECONCILIATION, BEN, at(30))).toHaveLength(1);
    expect(await readRecordPresence(database, RECONCILIATION, BEN, at(31))).toHaveLength(0);
  });

  it("takes someone out at once when they leave", async () => {
    await touchRecordPresence(database, RECONCILIATION, ANA, at(0));
    await leaveRecordPresence(database, RECONCILIATION, ANA);
    await leaveRecordPresence(database, RECONCILIATION, ANA);
    expect(await readRecordPresence(database, RECONCILIATION, BEN, at(1))).toHaveLength(0);
  });

  it("leaves out a member who has been deactivated", async () => {
    await touchRecordPresence(database, RECONCILIATION, ANA, at(0));
    await database
      .prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
      .bind(ANA)
      .run();
    expect(await readRecordPresence(database, RECONCILIATION, BEN, at(1))).toHaveLength(0);
  });

  it("clears the record's rows older than an hour on the next touch", async () => {
    await touchRecordPresence(database, RECONCILIATION, ANA, at(0));
    const later = new Date(Date.parse(at(0)) + 61 * 60 * 1000).toISOString();
    await touchRecordPresence(database, RECONCILIATION, BEN, later);
    const { results } = await database
      .prepare(`SELECT member_user_id FROM ${RECORD_PRESENCE_TABLE}`)
      .all<{ member_user_id: string }>();
    expect(results.map((row) => row.member_user_id)).toEqual([BEN]);
  });
});
