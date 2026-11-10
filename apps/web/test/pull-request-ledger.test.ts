/*
 * The Changelog screen's ledger: the real one built into the bundle reaches the screen as merged
 * pull requests, newest first, each linked to GitHub and placed in at least one area.
 */
import { describe, expect, it } from "vitest";
import {
  BEHIND_THE_SCENES,
  REPOSITORY_URL,
  UNRECORDED,
  countBy,
  mergedPullRequests,
  toMergedPullRequests,
} from "../src/lib/product-updates/pull-request-ledger.ts";

describe("the ledger built into the bundle", () => {
  const pullRequests = mergedPullRequests();

  it("holds merged pull requests, newest first, each once", () => {
    expect(pullRequests.length).toBeGreaterThan(0);
    const dates = pullRequests.map((pullRequest) => pullRequest.date);
    expect(dates).toEqual(dates.toSorted().toReversed());
    const numbers = pullRequests.map((pullRequest) => pullRequest.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives every pull request a full commit, an area and a link to each", () => {
    for (const pullRequest of pullRequests) {
      expect(pullRequest.sha).toMatch(/^[0-9a-f]{40}$/u);
      expect(pullRequest.areas.length).toBeGreaterThan(0);
      expect(pullRequest.pullRequestUrl).toBe(`${REPOSITORY_URL}/pull/${pullRequest.number}`);
      expect(pullRequest.commitUrl).toBe(`${REPOSITORY_URL}/commit/${pullRequest.sha}`);
    }
  });
});

describe("toMergedPullRequests", () => {
  const row = {
    number: 698,
    sha: "0123456789abcdef0123456789abcdef01234567",
    date: "2026-11-09",
    title: "Numbers sort as read",
    kind: "Changed",
    memberFacing: true,
    areas: ["Matters"],
    entry: "**Numbers sort.** The detail.\n\nA second paragraph.",
  };

  it("draws the entry as paragraphs and shortens the commit", () => {
    const [pullRequest] = toMergedPullRequests([row]);
    expect(pullRequest?.shortSha).toBe("0123456");
    expect(pullRequest?.entry).toHaveLength(2);
  });

  it("places a pull request with no visible area behind the scenes, and an unknown kind as unrecorded", () => {
    const [pullRequest] = toMergedPullRequests([
      { ...row, areas: [], kind: "Whatever", entry: "" },
    ]);
    expect(pullRequest?.areas).toEqual([BEHIND_THE_SCENES]);
    expect(pullRequest?.kind).toBe(UNRECORDED);
    expect(pullRequest?.entry).toEqual([]);
  });

  it("searches the title, the number, the commit and the entry", () => {
    const [pullRequest] = toMergedPullRequests([row]);
    for (const needle of ["numbers sort", "#698", "0123456", "second paragraph"]) {
      expect(pullRequest?.searchText).toContain(needle);
    }
  });
});

describe("countBy", () => {
  it("counts each value across rows, most common first", () => {
    const rows = toMergedPullRequests([
      {
        number: 1,
        sha: "a".repeat(40),
        date: "2026-01-01",
        title: "a",
        kind: "Added",
        memberFacing: false,
        areas: ["Matters", "Billing"],
        entry: "",
      },
      {
        number: 2,
        sha: "b".repeat(40),
        date: "2026-01-01",
        title: "b",
        kind: "Added",
        memberFacing: false,
        areas: ["Matters"],
        entry: "",
      },
    ]);
    expect(countBy(rows, (pullRequest) => pullRequest.areas)).toEqual([
      { value: "Matters", count: 2 },
      { value: "Billing", count: 1 },
    ]);
  });
});
