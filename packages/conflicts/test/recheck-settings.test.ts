import { expect, test } from "vitest";
import {
  DEFAULT_CONFLICTS_RECHECK_SETTINGS,
  periodicRescanIsDue,
  readConflictsRecheckSettings,
} from "../src/recheck-settings.ts";
import { recheckFixture } from "./support/recheck-fixture.ts";

// The numbers that decide how the automatic half of the engine behaves are a firm SETTING, not
// constants. Answering "how often should our caseload be re-screened" has to be a configuration
// change; burying it in code would make the platform the thing that answered it.

test("a firm that has configured nothing gets the shipped recommendation", async () => {
  const fixture = await recheckFixture("defaults");
  expect(await readConflictsRecheckSettings(fixture.database)).toEqual(
    DEFAULT_CONFLICTS_RECHECK_SETTINGS,
  );
});

test("a corrupt stored setting falls back rather than wedging the backstop off", async () => {
  const fixture = await recheckFixture("corrupt");
  fixture.raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.recheck', 'not json', '2026-08-13T09:00:00.000Z')`,
  );
  // A bad write must never be able to silently switch a firm's re-screening off — that failure would
  // look identical to a firm that is up to date.
  expect(await readConflictsRecheckSettings(fixture.database)).toEqual(
    DEFAULT_CONFLICTS_RECHECK_SETTINGS,
  );
});

test("a firm that has never run one is due immediately", () => {
  expect(
    periodicRescanIsDue(
      DEFAULT_CONFLICTS_RECHECK_SETTINGS,
      { lastRunAt: null },
      "2026-08-13T09:00:00.000Z",
    ),
  ).toBe(true);
});

test("the interval is honoured, and a firm that switched it off is never due", () => {
  const justRan = { lastRunAt: "2026-08-13T09:00:00.000Z" };
  expect(
    periodicRescanIsDue(DEFAULT_CONFLICTS_RECHECK_SETTINGS, justRan, "2026-08-16T09:00:00.000Z"),
  ).toBe(false);
  expect(
    periodicRescanIsDue(DEFAULT_CONFLICTS_RECHECK_SETTINGS, justRan, "2026-08-20T09:00:00.000Z"),
  ).toBe(true);
  expect(
    periodicRescanIsDue(
      { ...DEFAULT_CONFLICTS_RECHECK_SETTINGS, periodicRescanEnabled: false },
      { lastRunAt: null },
      "2026-08-20T09:00:00.000Z",
    ),
  ).toBe(false);
});

test("an unreadable stored instant is treated as never run, not as just run", () => {
  // The other reading would switch the backstop off permanently on one bad write, and do it
  // invisibly. Treating it as never run costs one extra pass.
  expect(
    periodicRescanIsDue(
      DEFAULT_CONFLICTS_RECHECK_SETTINGS,
      { lastRunAt: "whenever" },
      "2026-08-13T09:00:00.000Z",
    ),
  ).toBe(true);
});
