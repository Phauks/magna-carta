import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../src/quick-add-parser.ts";

describe("parseQuickAdd", () => {
  it("reads a leading decimal-hours duration, a matter hint, and the narrative", () => {
    expect(parseQuickAdd("0.5 Smith — drafted demand letter")).toEqual({
      durationMinutes: 30,
      matterHint: "Smith",
      narrative: "drafted demand letter",
    });
  });

  it("reads an explicit hours+minutes duration (1h30m)", () => {
    expect(parseQuickAdd("1h30m Acme — reviewed disclosure")).toEqual({
      durationMinutes: 90,
      matterHint: "Acme",
      narrative: "reviewed disclosure",
    });
  });

  it("reads a bare-minutes duration (45m)", () => {
    expect(parseQuickAdd("45m Jones — call with client")).toEqual({
      durationMinutes: 45,
      matterHint: "Jones",
      narrative: "call with client",
    });
  });

  it("accepts a hyphen separator as well as an em dash", () => {
    expect(parseQuickAdd("0.25 Doe - quick note")).toEqual({
      durationMinutes: 15,
      matterHint: "Doe",
      narrative: "quick note",
    });
  });

  it("returns a null matter hint when nothing precedes the separator", () => {
    // No matter token before the dash: the hint stays null rather than guessing, so the UI
    // never auto-picks a matter the writer did not name.
    expect(parseQuickAdd("0.5 — research")).toEqual({
      durationMinutes: 30,
      matterHint: null,
      narrative: "research",
    });
  });

  it("keeps a multi-word matter hint verbatim and never auto-resolves it", () => {
    // The parser surfaces the raw hint string only; resolving it to one of the firm's matters
    // (and refusing an ambiguous match) is the route's job, not the parser's.
    expect(parseQuickAdd("2h Smith v. Jones — prepared for hearing")).toEqual({
      durationMinutes: 120,
      matterHint: "Smith v. Jones",
      narrative: "prepared for hearing",
    });
  });

  it("treats text with no separator as narrative-only", () => {
    expect(parseQuickAdd("0.5 drafted demand letter")).toEqual({
      durationMinutes: 30,
      matterHint: null,
      narrative: "drafted demand letter",
    });
  });

  it("throws when no duration can be read", () => {
    expect(() => parseQuickAdd("Smith — drafted demand letter")).toThrow(/duration/);
  });

  it("throws on a zero or negative duration", () => {
    expect(() => parseQuickAdd("0 Smith — note")).toThrow(/duration/);
  });
});
