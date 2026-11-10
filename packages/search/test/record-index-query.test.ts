import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  parseRecordQuery,
  RECORD_INDEX_MATCH_CONDITION,
  RECORD_QUERY_MATTERS_LIMIT,
  recordIdsMatchingSubquery,
  recordIndexLeadingFrom,
  recordMatchExpression,
  recordSourceCondition,
} from "../src/record-index-query.ts";
import { matterScopeToken } from "../src/record-index-schema.ts";

const MATTER = "matter_recordIndex000000000000000" as MatterId;

describe("parseRecordQuery", () => {
  it("reads each word as a term and the last one as still being typed", () => {
    expect(parseRecordQuery("drainage ease")).toEqual([
      { tokens: ["drainage"], prefix: false },
      { tokens: ["ease"], prefix: true },
    ]);
  });

  it("treats a trailing space as the end of the word", () => {
    expect(parseRecordQuery("drainage ease ")).toEqual([
      { tokens: ["drainage"], prefix: false },
      { tokens: ["ease"], prefix: false },
    ]);
  });

  it("reads quoted words as one run, and does not extend a finished quotation", () => {
    expect(parseRecordQuery('"drainage easement"')).toEqual([
      { tokens: ["drainage", "easement"], prefix: false },
    ]);
    expect(parseRecordQuery('survey "drainage easement" her')).toEqual([
      { tokens: ["survey"], prefix: false },
      { tokens: ["drainage", "easement"], prefix: false },
      { tokens: ["her"], prefix: true },
    ]);
  });

  it("reads an unfinished quotation as ordinary words", () => {
    expect(parseRecordQuery('survey "drainage ease')).toEqual([
      { tokens: ["survey"], prefix: false },
      { tokens: ["drainage"], prefix: false },
      { tokens: ["ease"], prefix: true },
    ]);
  });

  it("keeps a word the tokenizer would split as one adjacent run", () => {
    expect(parseRecordQuery("O'Brien 2026-0142")).toEqual([
      { tokens: ["O", "Brien"], prefix: false },
      { tokens: ["2026", "0142"], prefix: true },
    ]);
  });

  it("keeps letters and digits of any script", () => {
    expect(parseRecordQuery("Peña 契約")).toEqual([
      { tokens: ["Peña"], prefix: false },
      { tokens: ["契約"], prefix: true },
    ]);
  });

  it("finds nothing to ask in text with no letter or digit", () => {
    expect(parseRecordQuery("")).toEqual([]);
    expect(parseRecordQuery("   ")).toEqual([]);
    expect(parseRecordQuery('"" - * ( ) :')).toEqual([]);
  });
});

describe("recordMatchExpression", () => {
  it("carries the words, and the matter as a token in its own column", () => {
    expect(recordMatchExpression("drainage ease", { sourceKeys: ["notes"], matter: MATTER })).toBe(
      `scope:"${matterScopeToken(MATTER)}" AND {title body}:("drainage" AND "ease"*)`,
    );
  });

  it("names no matter for a read of the firm, and never names the sources", () => {
    // The sources are a condition on the entry row, not part of the match.
    expect(recordMatchExpression("easement ", { sourceKeys: ["notes", "magnus-turns"] })).toBe(
      `{title body}:("easement")`,
    );
  });

  it("narrows to records on no matter", () => {
    expect(
      recordMatchExpression("easement ", { sourceKeys: ["communications"], matter: "none" }),
    ).toBe(`scope:"nomatter" AND {title body}:("easement")`);
  });

  it("names several matters as alternatives in the scope column", () => {
    const other = "matter_recordIndexOther0000000000" as MatterId;
    expect(
      recordMatchExpression("easement ", { sourceKeys: ["notes"], matters: [MATTER, other] }),
    ).toBe(
      `scope:("${matterScopeToken(MATTER)}" OR "${matterScopeToken(other)}") AND {title body}:("easement")`,
    );
    // One matter given by name wins over a list.
    expect(
      recordMatchExpression("easement ", { sourceKeys: ["notes"], matter: MATTER, matters: [] }),
    ).toBe(`scope:"${matterScopeToken(MATTER)}" AND {title body}:("easement")`);
  });

  it("refuses a list of matters longer than one question may name", () => {
    const matters = Array.from(
      { length: RECORD_QUERY_MATTERS_LIMIT + 1 },
      (_, index) => `matter_${index}` as MatterId,
    );
    expect(() => recordMatchExpression("easement", { sourceKeys: ["notes"], matters })).toThrow(
      /at most \d+ matters, not \d+/u,
    );
  });

  it("is null when there is nothing to match or nowhere to look", () => {
    expect(recordMatchExpression("  ", { sourceKeys: ["notes"] })).toBeNull();
    expect(recordMatchExpression("easement", { sourceKeys: [] })).toBeNull();
    expect(recordMatchExpression("easement", { sourceKeys: ["notes"], matters: [] })).toBeNull();
  });

  it("refuses a source that was never declared", () => {
    expect(() => recordMatchExpression("easement", { sourceKeys: ["note"] })).toThrow(
      /no record index source is declared as "note"/u,
    );
  });

  // The match language's own words reach the expression only as quoted literals. Every token is
  // letters and digits, so nothing a reader types can close a quotation or open a group.
  it("never passes a reader's operators through", () => {
    const hostile = [
      "trust AND estate",
      "trust OR estate NOT will",
      "NEAR(trust estate, 2)",
      "title: secret",
      "scope:srcnotes",
      "{title body}: x",
      'say "hello" AND "goodbye',
      "wild* card^2",
      "a - b + c",
      "(unbalanced",
      "'; DROP TABLE matter_note; --",
    ];
    for (const text of hostile) {
      const expression = recordMatchExpression(text, { sourceKeys: ["notes"] });
      expect(expression).not.toBeNull();
      const terms = expression!.slice(expression!.indexOf("{title body}:(") + 14, -1);
      // Nothing but quoted runs of letters and digits, an optional prefix star, and AND between.
      expect(terms).toMatch(/^"[\p{L}\p{N} ]+"\*?(?: AND "[\p{L}\p{N} ]+"\*?)*$/u);
    }
  });
});

describe("the matter scope token", () => {
  it("is the same bytes the database computes for a matter", () => {
    // `'m' || lower(hex(matter_id))` in SQL; the two must agree or a matter read matches nothing.
    expect(matterScopeToken("matter_aB1")).toBe("m6d61747465725f614231");
  });
});

describe("recordSourceCondition", () => {
  it("names one source or several as literals from the declarations", () => {
    expect(recordSourceCondition(["notes"])).toBe("record_text_entry.source = 'notes'");
    expect(recordSourceCondition(["notes", "magnus-turns"])).toBe(
      "record_text_entry.source IN ('notes', 'magnus-turns')",
    );
  });

  it("refuses an undeclared source, and a read that names none", () => {
    expect(() => recordSourceCondition(["notes' OR 1=1 --"])).toThrow(/no record index source/u);
    expect(() => recordSourceCondition([])).toThrow(/at least one source/u);
  });
});

describe("recordIndexLeadingFrom", () => {
  it("leads with the index and reaches the consumer's table by its identifier", () => {
    const from = recordIndexLeadingFrom("notes", "matter_note");
    expect(from).toBe(
      "record_text_fts " +
        "CROSS JOIN record_text_entry ON record_text_entry.id = record_text_fts.rowid " +
        "AND record_text_entry.source = 'notes' " +
        "CROSS JOIN matter_note ON matter_note.id = record_text_entry.record_id",
    );
    expect(from).not.toContain("?");
    expect(RECORD_INDEX_MATCH_CONDITION).toBe("record_text_fts MATCH ?");
  });

  it("refuses to join a source to a table it does not index", () => {
    expect(() => recordIndexLeadingFrom("notes", "time_entry")).toThrow(/indexes matter_note/u);
  });
});

describe("recordIdsMatchingSubquery", () => {
  it("takes one binding and names its source as a literal from the declaration", () => {
    const subquery = recordIdsMatchingSubquery("notes");
    expect(subquery.split("?").length - 1).toBe(1);
    expect(subquery).toContain("record_text_entry.source = 'notes'");
  });

  it("refuses a source that was never declared", () => {
    expect(() => recordIdsMatchingSubquery("notes' OR 1=1 --")).toThrow(/no record index source/u);
  });
});
