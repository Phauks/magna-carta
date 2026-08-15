import { describe, expect, it } from "vitest";
import {
  countAreas,
  countStatuses,
  emptyHistory,
  missingCommits,
  orderSnapshots,
  parseHistory,
  readSnapshot,
  serializeHistory,
  summariseHistory,
  unreadSnapshot,
} from "./register-history.mjs";
import { LEDGER_STATUSES } from "./roadmap.mjs";

// A commit hash only has to be forty hex characters to be a valid key; the letter says which one.
const hash = (letter) => letter.repeat(40);

function areas(...entries) {
  return entries.map(([name, ...statuses]) => ({
    name,
    nodes: statuses.map((status) => ({ status })),
  }));
}

function snapshot(letter, date, ...entries) {
  return readSnapshot({ commit: hash(letter), date }, areas(...entries), LEDGER_STATUSES);
}

describe("one snapshot", () => {
  it("counts every ledger status, including the ones no node holds", () => {
    const counts = countStatuses([{ status: "shipped" }, { status: "shipped" }], LEDGER_STATUSES);
    expect(counts.shipped).toBe(2);
    expect(counts.cut).toBe(0);
    expect(Object.keys(counts)).toEqual(LEDGER_STATUSES);
  });

  it("keeps two numbers per area, which is what the movement table reads", () => {
    expect(countAreas(areas(["trust.md", "shipped", "planned"]))).toEqual([
      { name: "trust.md", total: 2, shipped: 1 },
    ]);
  });

  it("records the total and the per-status counts of the ledger at that commit", () => {
    const record = snapshot(
      "a",
      "2026-07-14",
      ["trust.md", "shipped", "planned"],
      ["ai.md", "cut"],
    );
    expect(record).toMatchObject({ commit: hash("a"), date: "2026-07-14", read: true, total: 3 });
    expect(record.statuses.shipped).toBe(1);
    expect(record.areas).toHaveLength(2);
  });
});

describe("the history file", () => {
  it("round-trips through its own serializer", () => {
    const history = {
      ...emptyHistory(),
      snapshots: [
        snapshot("a", "2026-07-14", ["trust.md", "shipped"]),
        unreadSnapshot({ commit: hash("b"), date: "2026-07-15" }, 'unknown status "built"'),
      ],
    };
    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  it("puts each snapshot's statuses and each area on one line, so a landed commit is one readable diff", () => {
    const text = serializeHistory({
      ...emptyHistory(),
      snapshots: [snapshot("a", "2026-07-14", ["trust.md", "shipped"], ["ai.md", "cut"])],
    });
    expect(text).toContain('"statuses": {"shipped":1,');
    expect(text).toContain('        {"name":"trust.md","total":1,"shipped":1},\n');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("refuses a commit that was not read and gives no reason, because that is indistinguishable from a guess", () => {
    const text = JSON.stringify({
      ...emptyHistory(),
      snapshots: [{ commit: hash("a"), date: "2026-07-14", read: false }],
    });
    expect(() => parseHistory(text)).toThrow(/gives no reason/);
  });

  it("refuses a file written by a different format, rather than reading its fields as if they matched", () => {
    const text = JSON.stringify({ format: 99, generatedBy: "x", snapshots: [] });
    expect(() => parseHistory(text)).toThrow(/format 99/);
  });

  it("refuses a snapshot with no full commit hash, since the hash is the key", () => {
    const text = JSON.stringify({
      ...emptyHistory(),
      snapshots: [{ commit: "ad6526da", date: "2026-07-14", read: false, reason: "x" }],
    });
    expect(() => parseHistory(text)).toThrow(/full commit hash/);
  });
});

describe("merging with what is already on disk", () => {
  const known = {
    ...emptyHistory(),
    snapshots: [snapshot("a", "2026-07-14", ["trust.md", "shipped"])],
  };

  it("asks for only the commits the file does not already hold", () => {
    const wanted = missingCommits(known, [
      { commit: hash("a"), date: "2026-07-14" },
      { commit: hash("b"), date: "2026-07-15" },
    ]);
    expect(wanted).toEqual([{ commit: hash("b"), date: "2026-07-15" }]);
  });

  it("orders the series by the log and not by the order rows were appended", () => {
    const addition = snapshot("b", "2026-07-15", ["trust.md", "shipped", "shipped"]);
    const { snapshots, dropped } = orderSnapshots(
      known,
      [
        { commit: hash("b"), date: "2026-07-15" },
        { commit: hash("a"), date: "2026-07-14" },
      ],
      [addition],
    );
    expect(snapshots.map((entry) => entry.commit)).toEqual([hash("b"), hash("a")]);
    expect(dropped).toEqual([]);
  });

  it("drops a snapshot only when its commit has left the repository, and says which", () => {
    const { snapshots, dropped, retained } = orderSnapshots(
      known,
      [{ commit: hash("c"), date: "2026-07-16" }],
      [snapshot("c", "2026-07-16", ["trust.md", "shipped"])],
      (commit) => commit !== hash("a"),
    );
    expect(snapshots.map((entry) => entry.commit)).toEqual([hash("c")]);
    expect(dropped.map((entry) => entry.commit)).toEqual([hash("a")]);
    expect(retained).toEqual([]);
  });

  it("keeps a snapshot the walk cannot see while its commit still exists, in date order", () => {
    // Absent from this walk is a fact about the ref being walked — a branch sees only its own line
    // of descent — so it is never on its own grounds to delete a committed reading.
    const { snapshots, dropped, retained } = orderSnapshots(
      known,
      [{ commit: hash("c"), date: "2026-07-16" }],
      [snapshot("c", "2026-07-16", ["trust.md", "shipped"])],
    );
    expect(snapshots.map((entry) => entry.commit)).toEqual([hash("a"), hash("c")]);
    expect(retained.map((entry) => entry.commit)).toEqual([hash("a")]);
    expect(dropped).toEqual([]);
  });
});

describe("summariseHistory", () => {
  const history = {
    ...emptyHistory(),
    snapshots: [
      snapshot("a", "2026-07-14", ["trust.md", "shipped", "planned"], ["ai.md", "planned"]),
      unreadSnapshot({ commit: hash("b"), date: "2026-07-18" }, 'unknown status "built"'),
      unreadSnapshot({ commit: hash("c"), date: "2026-07-19" }, 'unknown status "built"'),
      snapshot("d", "2026-07-21", ["trust.md", "shipped", "shipped"], ["ai.md", "shipped"]),
      snapshot("e", "2026-07-28", ["trust.md", "shipped", "shipped"], ["ai.md", "shipped", "cut"]),
    ],
  };
  const summary = summariseHistory(history);

  it("says nothing at all when no commit in the series was read", () => {
    expect(
      summariseHistory({
        ...emptyHistory(),
        snapshots: [unreadSnapshot({ commit: hash("a"), date: "2026-07-14" }, "malformed")],
      }),
    ).toBeNull();
  });

  it("counts the change between consecutive read commits, never across the unread ones", () => {
    expect(summary.rows.map((row) => row.shippedChange)).toEqual([null, 2, 0]);
    expect(summary.rows.map((row) => row.unreadBefore)).toEqual([0, 2, 0]);
  });

  it("reports the endpoints and the span the reader is being shown", () => {
    expect(summary.shippedFirst).toBe(1);
    expect(summary.shippedLast).toBe(3);
    expect(summary.shippedChange).toBe(2);
    expect(summary.totalChange).toBe(1);
    expect(summary.spanDays).toBe(14);
    expect(summary.unread).toHaveLength(2);
  });

  it("states a rate as a rate, over the days that actually elapsed", () => {
    expect(summary.ratePerWeek).toBeCloseTo(1, 5);
  });

  it("rates the stretch since the last gap separately, because that stretch has no hole in it", () => {
    expect(summary.sinceLastGap).toMatchObject({ days: 7, shippedChange: 0, snapshots: 2 });
    expect(summary.sinceLastGap.ratePerWeek).toBe(0);
  });

  it("gives no rate for a stretch that spans no elapsed time, rather than dividing by zero", () => {
    const sameDay = {
      ...emptyHistory(),
      snapshots: [
        unreadSnapshot({ commit: hash("a"), date: "2026-07-14" }, "malformed"),
        snapshot("b", "2026-07-15", ["trust.md", "shipped"]),
        snapshot("c", "2026-07-15", ["trust.md", "shipped"]),
      ],
    };
    expect(summariseHistory(sameDay).sinceLastGap).toBeNull();
    expect(summariseHistory(sameDay).ratePerWeek).toBeNull();
  });

  it("measures each area between the first and the last read commit", () => {
    expect(summary.areas).toEqual([
      {
        name: "trust.md",
        presentThen: true,
        thenTotal: 2,
        thenShipped: 1,
        nowTotal: 2,
        nowShipped: 2,
        shippedChange: 1,
        nodesAdded: 0,
      },
      {
        name: "ai.md",
        presentThen: true,
        thenTotal: 1,
        thenShipped: 0,
        nowTotal: 2,
        nowShipped: 1,
        shippedChange: 1,
        nodesAdded: 1,
      },
    ]);
  });

  it("marks an area that did not exist at the first snapshot instead of printing a zero for it", () => {
    const added = {
      ...emptyHistory(),
      snapshots: [
        snapshot("a", "2026-07-14", ["trust.md", "shipped"]),
        snapshot("b", "2026-07-21", ["trust.md", "shipped"], ["community.md", "shipped"]),
      ],
    };
    const community = summariseHistory(added).areas.find((area) => area.name === "community.md");
    expect(community).toMatchObject({ presentThen: false, thenShipped: null, shippedChange: 1 });
  });

  it("keeps an area the ledger no longer has, so the series cannot quietly lose one", () => {
    const removed = {
      ...emptyHistory(),
      snapshots: [
        snapshot("a", "2026-07-14", ["trust.md", "shipped"], ["gone.md", "shipped"]),
        snapshot("b", "2026-07-21", ["trust.md", "shipped"]),
      ],
    };
    const gone = summariseHistory(removed).areas.find((area) => area.name === "gone.md");
    expect(gone).toMatchObject({ thenShipped: 1, nowShipped: null, shippedChange: null });
  });
});
