import { z } from "zod";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  readFirmSetting,
  writeFirmSettingStatement,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";

// The calendar's firm-configurable facts: what the firm decides once about how it reads its own
// calendar, held in the per-firm setting table and read by every calendar surface.

// WHICH DAY A WEEK BEGINS ON.
//
// A firm setting, not a personal preference, by the owner's ruling: the week is the unit a firm
// plans in, and two members of one firm looking at the same week must see the same grid — a
// deadline "next week" has to mean the same seven days to everybody who reads it. 0 is Sunday and
// 1 is Monday, the two starts practice actually uses; the vocabulary is closed so a grid never has
// to draw a week that begins on a Wednesday.
//
// Sunday by default, because United States legal practice reads a Sunday-start week, and because a
// missing row must be the default a firm that has never opened the setting expects.
export const WEEK_STARTS_ON_VALUES = [0, 1] as const;
export type WeekStartsOn = (typeof WEEK_STARTS_ON_VALUES)[number];
export const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 0;

export const calendarWeekStartsOnDefinition: FirmSettingDefinition<WeekStartsOn> = {
  key: "calendar.weekStartsOn",
  schema: z.union([z.literal(0), z.literal(1)]),
  defaultValue: DEFAULT_WEEK_STARTS_ON,
};

export function readCalendarWeekStartsOn(database: SqlDatabase): Promise<WeekStartsOn> {
  return readFirmSetting(database, calendarWeekStartsOnDefinition);
}

export function writeCalendarWeekStartsOnStatement(
  database: SqlDatabase,
  weekStartsOn: WeekStartsOn,
  now: string,
): SqlStatement {
  return writeFirmSettingStatement(database, calendarWeekStartsOnDefinition, weekStartsOn, now);
}
