/*
 * The Time Sheet's store, and what it actually sends.
 *
 * The sheet saves behind the reader: a cell change settles, a write goes out, and the row's mark
 * says whether it landed. That makes the store the one place where "the surface works" is decided,
 * and it had no coverage at all — which is how every write except the first came to be answered 400
 * without a single failing test. So these assert the REQUESTS the store makes, over the exact path
 * a person walks: create a row, type into it again, strike it.
 *
 * The other half is the undo stack telling the truth. A step is only offered where the store can
 * genuinely put the thing back, and these pin both directions of that: a strike offers no step,
 * and a snapshot older than a strike does not resurrect the struck entry.
 *
 * The third half, added when the sheet became firm-wide, is the MATTER. A row may be captured
 * without one and is then not sent at all, because capture takes a matter; setting one is what puts
 * the row on the wire, and it is the ROW's matter that goes, never the surface's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmMemberSummary } from "../src/lib/members/members-api.ts";
import type { TimeEntrySummary } from "../src/lib/matters/time-api.ts";
import { TimeSheetStore } from "../src/lib/time/time-sheet-store.svelte.ts";
import {
  IDEMPOTENCY_HEADER,
  recordRequests,
  type RequestRecorder,
} from "./time-request-recorder.ts";

/** Longer than the settle the store waits out before a change goes on the wire. */
const PAST_THE_SETTLE = 1000;

const MEMBERS: readonly FirmMemberSummary[] = [
  {
    userId: "member-1",
    displayName: "Alexandra Whitfield",
    status: "active",
    roleNames: [],
    hasProfessionalProfile: true,
  },
];

function entry(overrides: Partial<TimeEntrySummary> = {}): TimeEntrySummary {
  return {
    id: "entry-1",
    matterId: "matter-1",
    timekeeperUserId: "member-1",
    workDate: "2026-08-30",
    durationMinutes: 90,
    rawDurationMinutes: 90,
    narrative: "Reviewed the discovery responses",
    billable: true,
    amountMinor: 45_000,
    currency: "USD",
    status: "draft",
    timekeeperName: "Alexandra Whitfield",
    ...overrides,
  };
}

interface Harness {
  store: TimeSheetStore;
  recorder: RequestRecorder;
  announcements: string[];
}

/**
 * A sheet over these entries.
 *
 * `matterFilter` is the door it was opened by: a matter identifier for the sheet the matter's Time
 * tab opens, and null for the firm-wide sheet in the top bar. The default is the matter door,
 * because that is what most of these were written against; the firm-wide cases pass null.
 */
function sheetOver(
  entries: readonly TimeEntrySummary[],
  matterFilter: string | null = "matter-1",
): Harness {
  const recorder = recordRequests({ timeEntryId: "entry-written" });
  vi.stubGlobal("fetch", recorder.fetch);
  const announcements: string[] = [];
  const store = new TimeSheetStore({
    matterFilter: () => matterFilter,
    entries: () => entries,
    members: () => MEMBERS,
    sessionUserId: () => "member-1",
    today: () => "2026-08-30",
    onChanged: () => {},
    announce: (message) => announcements.push(message),
  });
  store.adoptEntries(entries);
  return { store, recorder, announcements };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("saving a row the reader is typing into", () => {
  it("changes an existing entry with the Idempotency-Key the contract requires", async () => {
    const { store, recorder } = sheetOver([entry()]);

    store.setDescription("entry-1", "Reviewed the discovery responses and the exhibits");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const sent = recorder.onlyCall();
    expect(sent.method).toBe("PATCH");
    expect(sent.path).toBe("/api/v1/time-entries/entry-1");
    expect(sent.headers[IDEMPOTENCY_HEADER]).toBeDefined();
  });

  it("keeps sending a key on the SECOND change, which is where the surface used to break", async () => {
    const { store, recorder } = sheetOver([]);
    const row = store.addRow("2026-08-30");

    // First: enough to be accepted, so it is created.
    store.setDescription(row.key, "Drafted the motion");
    store.setWorkedSeconds(row.key, 3600);
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    // Then a later keystroke on the same row, which takes the update branch.
    store.setDescription(row.key, "Drafted the motion in limine");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const methods = recorder.writes.map((call) => call.method);
    expect(methods).toContain("POST");
    expect(methods).toContain("PATCH");
    const keyless = recorder.writes.filter(
      (call) => call.headers[IDEMPOTENCY_HEADER] === undefined,
    );
    expect(keyless.map((call) => `${call.method} ${call.path}`)).toEqual([]);
  });

  it("does not write a row the capture route would refuse, and says what it waits on", async () => {
    const { store, recorder } = sheetOver([]);
    const row = store.addRow("2026-08-30");

    store.setDescription(row.key, "Drafted the motion");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(recorder.writes).toEqual([]);
    expect(store.rowByKey(row.key)?.saveState).toBe("unsaved");
  });
});

describe("a row captured before anybody knew where it belonged", () => {
  it("is not sent at all, because capture takes a matter", async () => {
    const { store, recorder } = sheetOver([], null);
    const row = store.addRow("2026-08-30");

    store.setDescription(row.key, "Reviewed the incoming discovery");
    store.setWorkedSeconds(row.key, 1440);
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(recorder.writes).toEqual([]);
    expect(store.rowByKey(row.key)?.saveState).toBe("unsaved");
  });

  it("holds a provisional code, so the row has a name while it waits", () => {
    const { store } = sheetOver([], null);
    expect(store.addRow("2026-08-30").provisionalCode).toBe("TMP-0001");
    expect(store.addRow("2026-08-30").provisionalCode).toBe("TMP-0002");
  });

  it("writes itself the moment a matter is set, carrying THAT matter", async () => {
    const { store, recorder } = sheetOver([], null);
    const row = store.addRow("2026-08-30");
    store.setDescription(row.key, "Reviewed the incoming discovery");
    store.setWorkedSeconds(row.key, 1440);
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    store.setMatter(row.key, "matter-2");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const sent = recorder.onlyCall();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/api/v1/time-entries");
    expect(sent.body).toMatchObject({ matterId: "matter-2" });
    expect(sent.headers[IDEMPOTENCY_HEADER]).toBeDefined();
  });

  it("starts on the matter the sheet was opened from, when it was opened from one", () => {
    const { store } = sheetOver([]);
    expect(store.addRow("2026-08-30").matterId).toBe("matter-1");
  });
});

describe("the matter of an entry the firm already holds", () => {
  it("is refused, because nothing moves an entry between matters", async () => {
    const { store, recorder, announcements } = sheetOver([entry()]);

    store.setMatter("entry-1", "matter-2");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(store.rowByKey("entry-1")?.matterId).toBe("matter-1");
    expect(recorder.writes).toEqual([]);
    expect(announcements.join(" ")).toContain("nothing moves an entry from one matter to another");
  });
});

describe("striking an entry", () => {
  it("sends the void with an Idempotency-Key", async () => {
    const { store, recorder } = sheetOver([entry()]);

    await store.voidRow("entry-1");

    const sent = recorder.onlyCall();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/api/v1/time-entries/entry-1/void");
    expect(sent.headers[IDEMPOTENCY_HEADER]).toBeDefined();
  });

  it("offers no undo step, because nothing un-strikes an entry", async () => {
    const { store } = sheetOver([entry()]);

    await store.voidRow("entry-1");

    expect(store.history.canUndo).toBe(false);
    expect(store.history.undoLabels).toEqual([]);
  });

  it("says at the time that undo does not reach it", async () => {
    const { announcements, store } = sheetOver([entry()]);

    await store.voidRow("entry-1");

    expect(announcements.join(" ")).toContain("Undo does not reach it");
  });

  it("does offer a step for a row nothing was ever written for, and puts it back", async () => {
    const { store } = sheetOver([]);
    const row = store.addRow("2026-08-30");
    store.setDescription(row.key, "Drafted the motion");

    await store.voidRow(row.key);
    expect(store.rows.some((other) => other.key === row.key)).toBe(false);

    store.history.undo();
    expect(store.rowByKey(row.key)?.description).toBe("Drafted the motion");
  });
});

describe("adding a row", () => {
  it("offers no undo step: the row's own remove control is what takes it away", () => {
    const { store } = sheetOver([]);

    store.addRow("2026-08-30");

    expect(store.history.canUndo).toBe(false);
  });
});

describe("an undo reaching back past a strike", () => {
  it("does not put the struck entry back on the sheet as a workable draft", async () => {
    const { store } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    await store.voidRow("entry-1");
    store.history.undo();
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(store.rowByKey("entry-1")?.status).toBe("void");
  });

  it("writes nothing to an entry that has since been struck", async () => {
    const { store, recorder } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);
    await store.voidRow("entry-1");

    const before = recorder.writes.length;
    store.history.undo();
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(recorder.writes.slice(before)).toEqual([]);
  });
});

describe("an undo of a field change", () => {
  it("puts the value back AND writes it through, with a key on that write too", async () => {
    const { store, recorder } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses and the exhibits");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const before = recorder.writes.length;
    store.history.undo();
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(store.rowByKey("entry-1")?.description).toBe("Reviewed the discovery responses");
    const written = recorder.writes.slice(before);
    expect(written).not.toEqual([]);
    for (const call of written) {
      expect(call.headers[IDEMPOTENCY_HEADER]).toBeDefined();
      expect(call.body).toMatchObject({ narrative: "Reviewed the discovery responses" });
    }
  });
});
