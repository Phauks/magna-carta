/*
 * The Time Sheet's store, and what it actually sends.
 *
 * The sheet saves behind the reader: a cell change settles, a write goes out, and the row's mark
 * says whether it landed. That makes the store the one place where "the surface works" is decided,
 * and it had no coverage at all — which is how every write except the first came to be answered 400
 * without a single failing test. So these assert the REQUESTS the store makes, over the exact path
 * a person walks: create a row, type into it again, void it.
 *
 * The other half is the undo stack telling the truth. A step is only offered where the store can
 * genuinely put the thing back, and these pin both directions of that: a void offers no step,
 * and a snapshot older than a void does not resurrect the voided entry.
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
  /** What every call answers with. A test that asserts a body the store ADOPTS supplies its own. */
  answer: unknown = { timeEntryId: "entry-written" },
): Harness {
  const recorder = recordRequests(answer);
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
  /*
   * A misfiled entry MOVES rather than being voided and re-typed: it keeps its number, its memo,
   * its codes, its files and its history. The move is its own route, not the debounced cell save,
   * because it is a cross-matter write with its own refusals.
   */
  it("moves it, on its own route, with an Idempotency-Key", async () => {
    const { store, recorder } = sheetOver([entry()]);

    store.setMatter("entry-1", "matter-2");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const sent = recorder.onlyCall();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/api/v1/time-entries/entry-1/refile");
    expect(sent.body).toEqual({ matterId: "matter-2" });
    expect(sent.headers[IDEMPOTENCY_HEADER]).toBeDefined();
    expect(store.rowByKey("entry-1")?.matterId).toBe("matter-2");
  });

  /*
   * The rate and the rounding are resolved against the matter, so they come back from the move and
   * are adopted. A row that kept the figures it had on the matter it just left would be showing one
   * client's money under another's name.
   */
  it("takes the figures the move answers with, because the money follows the matter", async () => {
    const { store } = sheetOver([entry()], "matter-1", {
      timeEntryId: "entry-1",
      matterId: "matter-2",
      durationMinutes: 45,
      rateE4: 4_000_000,
      amountMinor: 30_000,
      currency: "USD",
    });

    store.setMatter("entry-1", "matter-2");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const row = store.rowByKey("entry-1");
    expect(row?.billedMinutes).toBe(45);
    expect(row?.rateE4).toBe(4_000_000);
    expect(row?.amountMinor).toBe(30_000);
  });

  /*
   * A written entry has to be on a matter — the record has to be somewhere — so taking it off one
   * is the single thing a move cannot do, and it is refused here rather than sent.
   */
  it("refuses to take a written entry off its matter altogether", async () => {
    const { store, recorder, announcements } = sheetOver([entry()]);

    store.setMatter("entry-1", null);
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(store.rowByKey("entry-1")?.matterId).toBe("matter-1");
    expect(recorder.writes).toEqual([]);
    expect(announcements.join(" ")).toContain("must be on a matter");
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

  it("offers no undo step, because a void is a status change this stack cannot rewrite", async () => {
    const { store } = sheetOver([entry()]);

    await store.voidRow("entry-1");

    expect(store.history.canUndo).toBe(false);
    expect(store.history.undoLabels).toEqual([]);
  });

  it("says at the time that undo does not reach it, and where the repair actually is", async () => {
    const { announcements, store } = sheetOver([entry()]);

    await store.voidRow("entry-1");

    // Both halves. Saying only the first would leave a reader believing the void is permanent,
    // which it stopped being when the entry gained a way back to draft.
    const said = announcements.join(" ");
    expect(said).toContain("Undo can't reverse this");
    expect(said).toContain("restore it from the ledger or the entry window");
  });

  it("does offer a step for a row nothing was ever written for, and puts it back", async () => {
    const { store } = sheetOver([]);
    const row = store.addRow("2026-08-30");
    store.setDescription(row.key, "Drafted the motion");

    await store.voidRow(row.key);
    expect(store.rows.some((other) => other.key === row.key)).toBe(false);

    await store.history.undo();
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

describe("an undo reaching back past a void", () => {
  it("does not put the voided entry back on the sheet as a workable draft", async () => {
    const { store } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    await store.voidRow("entry-1");
    const outcome = await store.history.undo();
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    expect(store.rowByKey("entry-1")?.status).toBe("void");
    // And it says so rather than reporting a step it did not take.
    expect(outcome.moved).toBe(0);
    expect(outcome.failure?.label).toBe("the description on this entry");
  });

  it("writes nothing to an entry that has since been voided", async () => {
    const { store, recorder } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);
    await store.voidRow("entry-1");

    const before = recorder.writes.length;
    await store.history.undo();
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
    await store.history.undo();

    expect(store.rowByKey("entry-1")?.description).toBe("Reviewed the discovery responses");
    const written = recorder.writes.slice(before);
    expect(written).not.toEqual([]);
    for (const call of written) {
      expect(call.headers[IDEMPOTENCY_HEADER]).toBeDefined();
      expect(call.body).toMatchObject({ narrative: "Reviewed the discovery responses" });
    }
  });

  /*
   * The reason a step is a pair of writes rather than a picture of the sheet. A snapshot cannot say
   * which field moved, so putting one back meant writing EVERY row — over rows the step never
   * touched, and over whatever somebody had changed in another window meanwhile.
   */
  it("writes the row the step changed, and no other row on the sheet", async () => {
    const { store, recorder } = sheetOver([
      entry({ id: "entry-1", narrative: "Reviewed the discovery responses" }),
      entry({ id: "entry-2", narrative: "Called the client" }),
    ]);
    store.setDescription("entry-1", "Reviewed the responses and the exhibits");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const before = recorder.writes.length;
    await store.history.undo();

    const written = recorder.writes.slice(before);
    expect(written).not.toEqual([]);
    for (const call of written) expect(call.path).toContain("entry-1");
  });

  /*
   * The announcement follows the write. A stack that answered on the pop told the reader the entry
   * went back while the write was still in the air — and said nothing when it then refused.
   */
  it("answers only once the write has answered", async () => {
    const { store, recorder } = sheetOver([entry()]);
    store.setDescription("entry-1", "Reviewed the responses and the exhibits");
    await vi.advanceTimersByTimeAsync(PAST_THE_SETTLE);

    const before = recorder.writes.length;
    const outcome = await store.history.undo();

    expect(recorder.writes.length).toBeGreaterThan(before);
    expect(outcome.moved).toBe(1);
    expect(outcome.label).toBe("the description on this entry");
    expect(outcome.failure).toBeNull();
  });
});
