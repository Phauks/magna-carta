import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHistory, snapshotAt, updateHistory } from "./build-register-history.mjs";
import { serializeHistory } from "./register-history.mjs";

// These exercise the reconstruction against a real repository, because what is being tested is
// exactly the reading of past commits: a stubbed git would test the stub. The repository is three
// commits of a toy ledger, one of which is written in a schema the parser does not accept.

let root = null;
let file = null;

function git(...args) {
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function node(id, status) {
  return `- id: ${id}\n  name: ${id}\n  scope: A capability.\n  status: ${status}\n`;
}

function commitLedger(message, files) {
  mkdirSync(join(root, "roadmap.d"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, "roadmap.d", name), body);
  }
  git("add", "-A");
  git("-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
}

function area(title, ...nodes) {
  return `# ${title}\n\n<!-- Feature ledger fragment. -->\n\n${nodes.join("\n")}`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "register-history-"));
  file = join(root, "history.json");
  git("init", "-q");
  // Named explicitly rather than left to init.defaultBranch: the reconstruction only writes on the
  // trunk, so which branch the fixture is on is part of what these tests are asserting.
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Ledger Test");
  git("config", "commit.gpgsign", "false");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("reading the ledger out of git", () => {
  it("records one snapshot per commit that touched the ledger, oldest first", () => {
    commitLedger("first", {
      "trust.md": area("Trust", node("trust.ledger", "shipped")),
      "README.md": "# Not an area file\n\nProse the parser never sees.\n",
    });
    commitLedger("second", {
      "trust.md": area("Trust", node("trust.ledger", "shipped"), node("trust.charges", "planned")),
    });
    writeFileSync(join(root, "unrelated.txt"), "not the ledger\n");
    git("add", "-A");
    git("commit", "-q", "-m", "third");

    const { history } = updateHistory({ root, file });

    expect(history.snapshots).toHaveLength(2);
    expect(history.snapshots.map((snapshot) => snapshot.total)).toEqual([1, 2]);
    expect(history.snapshots[1].statuses).toMatchObject({ shipped: 1, planned: 1 });
    expect(history.snapshots[1].areas).toEqual([
      { name: "trust.md", total: 2, shipped: 1, units: 2, unitsShipped: 1 },
    ]);
  });

  it("rebuilds over a file written by an older format, which is the one thing that error asks for", () => {
    // parseHistory refuses a foreign format with "rebuild it from scratch". Reading the committed
    // file on the rebuild path made that instruction impossible to follow: the rebuild died on the
    // same read, and the series stayed frozen at whatever the last compatible build left. A rebuild
    // recomputes every row from git and needs nothing on disk, so nothing on disk may stop it.
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    writeFileSync(
      file,
      JSON.stringify({ format: 0, generatedBy: "an older build", snapshots: [] }),
    );

    expect(() => updateHistory({ root, file })).toThrow(/format 0/);

    const { history } = updateHistory({ root, file, rebuild: true });
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0].units).toBe(1);
  });

  it("excludes a roll-up parent from the unit counts at every past commit, not only today", () => {
    // `trust` is a parent the moment `trust.ledger` exists beneath it — hierarchy is read off the
    // dotted id, so the reconstruction decides it from the ledger AS IT STOOD rather than from the
    // shape the ledger has now. Without that, a node that became a parent later would be counted as
    // a unit of work in every snapshot before it did.
    commitLedger("parent arrives", {
      "trust.md": area("Trust", node("trust", "partial"), node("trust.ledger", "shipped")),
    });

    const { history } = updateHistory({ root, file });
    const last = history.snapshots.at(-1);
    expect(last.total).toBe(2);
    expect(last.units).toBe(1);
    expect(last.unitStatuses).toMatchObject({ shipped: 1, partial: 0 });
    expect(last.areas).toEqual([
      { name: "trust.md", total: 2, shipped: 1, units: 1, unitsShipped: 1 },
    ]);
  });

  it("gives no row to a commit that touched only the ledger's README, which holds no node", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    commitLedger("format note", { "README.md": "# Feature-ledger fragments\n\nThe format.\n" });

    expect(updateHistory({ root, file }).history.snapshots).toHaveLength(1);
  });

  it("records a commit the parser cannot read as unread, with the parser's own reason", () => {
    commitLedger("legacy vocabulary", {
      "trust.md": area("Trust", node("trust.ledger", "built")),
    });
    commitLedger("vocabulary corrected", {
      "trust.md": area("Trust", node("trust.ledger", "shipped")),
    });

    const { history } = updateHistory({ root, file });

    expect(history.snapshots[0]).toMatchObject({ read: false });
    expect(history.snapshots[0].reason).toMatch(/trust\.md.*unknown status "built"/);
    // The unreadable commit stops nothing: the next one is read normally, which is what makes the
    // gap a hole in the series rather than the end of it.
    expect(history.snapshots[1]).toMatchObject({ read: true, total: 1 });
  });

  it("names every area that failed, not only the first", () => {
    commitLedger("two malformed areas", {
      "trust.md": area("Trust", node("trust.ledger", "built")),
      "ai.md": area("AI", node("ai.magnus", "underway")),
    });

    const [snapshot] = updateHistory({ root, file }).history.snapshots;
    expect(snapshot.reason).toContain("ai.md");
    expect(snapshot.reason).toContain("trust.md");
  });

  it("writes a file that reads back as the history it just built", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    const { history } = updateHistory({ root, file });
    expect(loadHistory(file)).toEqual(history);
  });
});

describe("the append path", () => {
  it("reads only the commits the file does not already hold", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    const first = updateHistory({ root, file });
    expect(first.added).toHaveLength(1);

    commitLedger("second", {
      "trust.md": area("Trust", node("trust.ledger", "shipped"), node("trust.charges", "shipped")),
    });
    const second = updateHistory({ root, file });

    expect(second.added).toHaveLength(1);
    expect(second.added[0].total).toBe(2);
    expect(second.history.snapshots).toHaveLength(2);
    // The earlier row is carried through untouched rather than recomputed.
    expect(second.history.snapshots[0]).toEqual(first.history.snapshots[0]);
  });

  it("does nothing at all when the file already holds every commit", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    updateHistory({ root, file });
    const before = readFileSync(file, "utf8");

    const again = updateHistory({ root, file });
    expect(again.added).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("recomputes every row on a rebuild, which is how a parser change reaches the past", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    const { history } = updateHistory({ root, file });

    const stale = structuredClone(history);
    stale.snapshots[0].total = 999;
    writeFileSync(file, serializeHistory(stale));
    expect(updateHistory({ root, file }).history.snapshots[0].total).toBe(999);

    expect(updateHistory({ root, file, rebuild: true }).history.snapshots[0].total).toBe(1);
  });

  it("drops a snapshot whose commit is no longer on the first-parent history, and reports it", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    const { history } = updateHistory({ root, file });
    const orphaned = structuredClone(history);
    orphaned.snapshots.push({
      commit: "f".repeat(40),
      date: "2026-07-14",
      read: false,
      reason: "from a branch that was rewritten",
    });
    writeFileSync(file, serializeHistory(orphaned));

    const { history: pruned, dropped } = updateHistory({ root, file });
    expect(dropped.map((snapshot) => snapshot.commit)).toEqual(["f".repeat(40)]);
    expect(pruned.snapshots).toHaveLength(1);
  });

  it("leaves the file exactly as it is when the git history cannot be walked", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    updateHistory({ root, file });
    const before = readFileSync(file, "utf8");

    const { unavailable } = updateHistory({ root, file, ref: "no-such-ref" });

    expect(unavailable).not.toBeNull();
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("off the trunk", () => {
  // `git log --first-parent` on a branch walks the BRANCH's line. Every trunk commit that landed
  // after the branch was cut is unreachable from it, so a rebuild there does not read a shorter
  // history — it deletes the committed snapshot of every one of those landings, in a file that is
  // committed. These fix the direction of that inference: unreachable from here is a fact about
  // here.
  function trunkWithTwoLandings() {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    git("branch", "cut-here");
    commitLedger("second", {
      "trust.md": area("Trust", node("trust.ledger", "shipped"), node("trust.charges", "shipped")),
    });
    return updateHistory({ root, file }).history;
  }

  it("leaves every committed snapshot alone on a branch cut before the later landings", () => {
    expect(trunkWithTwoLandings().snapshots).toHaveLength(2);
    const onTrunk = readFileSync(file, "utf8");

    git("checkout", "-q", "cut-here");
    const { history, offTrunk } = updateHistory({ root, file });

    expect(offTrunk).toMatch(/cut-here/);
    expect(readFileSync(file, "utf8")).toBe(onTrunk);
    expect(history.snapshots).toHaveLength(2);
  });

  it("declines a full rebuild there too, which is the destructive one", () => {
    trunkWithTwoLandings();
    const onTrunk = readFileSync(file, "utf8");

    git("checkout", "-q", "cut-here");
    expect(updateHistory({ root, file, rebuild: true }).offTrunk).not.toBeNull();
    expect(readFileSync(file, "utf8")).toBe(onTrunk);
  });

  it("declines at a revision that names no branch, such as a point back along the trunk", () => {
    trunkWithTwoLandings();
    const onTrunk = readFileSync(file, "utf8");

    // The shape of the accident: a ref inside the trunk's own line still cannot see what came after
    // it, and rebuilding from there would delete exactly those readings.
    expect(updateHistory({ root, file, ref: "main~1" }).offTrunk).toMatch(/names no branch/);
    expect(readFileSync(file, "utf8")).toBe(onTrunk);
  });

  it("still writes on the trunk itself, so the refusal is about the ref and not about writing", () => {
    trunkWithTwoLandings();
    commitLedger("third", {
      "trust.md": area(
        "Trust",
        node("trust.ledger", "shipped"),
        node("trust.charges", "shipped"),
        node("trust.reconciliation", "planned"),
      ),
    });

    const { history, offTrunk } = updateHistory({ root, file });
    expect(offTrunk).toBeNull();
    expect(history.snapshots).toHaveLength(3);
  });
});

describe("snapshotAt", () => {
  it("reports a commit that cannot be listed as unread rather than throwing the run over", () => {
    commitLedger("first", { "trust.md": area("Trust", node("trust.ledger", "shipped")) });
    const snapshot = snapshotAt(root, { commit: "0".repeat(40), date: "2026-07-14" });
    expect(snapshot.read).toBe(false);
    expect(snapshot.reason).toMatch(/could not be listed/);
  });
});
