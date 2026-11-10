import { describe, expect, it } from "vitest";
import {
  displayInitials,
  displayedVoteCount,
  suggestedDisplayName,
  voteCountText,
} from "../src/display.ts";
import { trendingScore } from "../src/ranking.ts";

describe("display", () => {
  it("withholds a vote count below the floor", () => {
    expect(displayedVoteCount(4)).toBeNull();
    expect(displayedVoteCount(5)).toBe(5);
    expect(voteCountText(2)).toBe("<5");
    expect(voteCountText(214)).toBe("214");
  });

  it("suggests a given name and family initial, never the full name", () => {
    expect(suggestedDisplayName("Dana", "Rivera")).toBe("Dana R.");
    expect(suggestedDisplayName("Priya", null)).toBe("Priya");
    expect(suggestedDisplayName(null, "Rivera")).toBe("Member");
  });

  it("builds initials from the display name", () => {
    expect(displayInitials("Dana R.")).toBe("DR");
    expect(displayInitials("Priya")).toBe("P");
    expect(displayInitials("J. Castellanos")).toBe("JC");
  });
});

describe("trendingScore", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("prefers more firms at the same age, and recent activity at the same firms", () => {
    expect(trendingScore(10, "2026-11-10T10:00:00Z", now)).toBeGreaterThan(
      trendingScore(5, "2026-11-10T10:00:00Z", now),
    );
    expect(trendingScore(5, "2026-11-10T11:00:00Z", now)).toBeGreaterThan(
      trendingScore(5, "2026-11-01T11:00:00Z", now),
    );
  });
});
