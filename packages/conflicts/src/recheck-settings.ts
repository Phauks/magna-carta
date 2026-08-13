import {
  readFirmSetting,
  writeFirmSettingStatement,
  type FirmSettingDefinition,
} from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { z } from "zod";

// THE FIRM'S RE-CHECK SETTINGS — the numbers that decide how the automatic half of the engine
// behaves, held as a firm setting rather than as constants.
//
// Every value here is shipped with a recommended default and is a CONFIGURATION change to alter, not
// a code change. That is deliberate: a number that decides how often a firm's caseload is re-screened
// is a professional-responsibility choice, and burying it in a constant would make the platform the
// one that made it. The setting in force at the time of a run is recorded on the run, so a later
// reader can tell which rule governed it.

const recheckSettingsSchema = z.object({
  // How many matters one corpus change may take onto the queue in a single relay cycle. This is a
  // bound on QUEUE MESSAGES, never on ledger rows: every affected matter always gets its row, and a
  // fan-out past this cap simply waits for the cron drain instead of being attempted at once.
  // Trimming the row set would convert a slow re-check into a missing one.
  maxMattersPerEvent: z.number().int().min(1).max(10_000),
  // Whether the clock-driven backstop runs at all. A firm may switch it off; the fact that it did is
  // recorded and reported, because a backstop that is off and invisible is worse than none at all.
  periodicRescanEnabled: z.boolean(),
  // How often an open matter is re-screened with no cause but the passage of time.
  periodicRescanIntervalDays: z.number().int().min(1).max(365),
  // How many matters one scheduled pass may enqueue. The re-scan walks a caseload over several
  // passes rather than putting a firm's whole open list on the queue at once.
  periodicRescanBatchSize: z.number().int().min(1).max(1_000),
});

export type ConflictsRecheckSettings = z.infer<typeof recheckSettingsSchema>;

// The shipped recommendation. Weekly is the design's proposal and is the owner's to change; it is a
// setting precisely so that answering the question is a configuration edit.
export const DEFAULT_CONFLICTS_RECHECK_SETTINGS: ConflictsRecheckSettings = {
  maxMattersPerEvent: 50,
  periodicRescanEnabled: true,
  periodicRescanIntervalDays: 7,
  periodicRescanBatchSize: 25,
};

export const conflictsRecheckSettingsDefinition: FirmSettingDefinition<ConflictsRecheckSettings> = {
  key: "conflicts.recheck",
  schema: recheckSettingsSchema,
  defaultValue: DEFAULT_CONFLICTS_RECHECK_SETTINGS,
};

export function readConflictsRecheckSettings(
  database: SqlDatabase,
): Promise<ConflictsRecheckSettings> {
  return readFirmSetting(database, conflictsRecheckSettingsDefinition);
}

// When the scheduled pass last enqueued a re-scan, held as its own setting rather than as a column on
// anything. It is operational bookkeeping about a sweep, not a fact about a matter, and putting it on
// a matter row would make every pass a write across the caseload.
const rescanStateSchema = z.object({ lastRunAt: z.string().nullable() });

export type ConflictsRescanState = z.infer<typeof rescanStateSchema>;

export const conflictsRescanStateDefinition: FirmSettingDefinition<ConflictsRescanState> = {
  key: "conflicts.recheck.rescan-state",
  schema: rescanStateSchema,
  defaultValue: { lastRunAt: null },
};

export function readConflictsRescanState(database: SqlDatabase): Promise<ConflictsRescanState> {
  return readFirmSetting(database, conflictsRescanStateDefinition);
}

export function writeConflictsRescanStateStatement(
  database: SqlDatabase,
  state: ConflictsRescanState,
  now: string,
): SqlStatement {
  return writeFirmSettingStatement(database, conflictsRescanStateDefinition, state, now);
}

// Whether the interval has elapsed. A firm that has never run one is due immediately — the first pass
// after the feature lands is the one that establishes the cadence.
export function periodicRescanIsDue(
  settings: ConflictsRecheckSettings,
  state: ConflictsRescanState,
  now: string,
): boolean {
  if (!settings.periodicRescanEnabled) return false;
  if (state.lastRunAt === null) return true;
  const last = Date.parse(state.lastRunAt);
  // An unparseable stored instant must not wedge the backstop off forever; treat it as never run.
  if (Number.isNaN(last)) return true;
  return Date.parse(now) - last >= settings.periodicRescanIntervalDays * 24 * 60 * 60 * 1000;
}
