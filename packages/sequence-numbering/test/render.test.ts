import { describe, expect, it } from "vitest";
import { type NumberSegment, numberingSchemeSchema } from "../src/segments.ts";
import { NumberingRenderError, deriveScopeKey, renderNumber } from "../src/render.ts";

const counter = (padWidth: number): NumberSegment => ({ kind: "counter", padWidth });
const literal = (text: string): NumberSegment => ({ kind: "literal", text });

describe("numberingSchemeSchema", () => {
  it("accepts a scheme with exactly one counter", () => {
    const result = numberingSchemeSchema.safeParse([
      { kind: "year", digits: 4 },
      literal("-"),
      counter(5),
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects a scheme with no counter", () => {
    expect(numberingSchemeSchema.safeParse([{ kind: "year", digits: 4 }]).success).toBe(false);
  });

  it("rejects a scheme with two counters", () => {
    expect(numberingSchemeSchema.safeParse([counter(4), literal("-"), counter(4)]).success).toBe(
      false,
    );
  });

  it("rejects a non-URL-safe literal", () => {
    expect(numberingSchemeSchema.safeParse([literal("a/b"), counter(4)]).success).toBe(false);
    expect(numberingSchemeSchema.safeParse([literal("a b"), counter(4)]).success).toBe(false);
  });

  it("rejects a counter with a non-positive pad width", () => {
    expect(numberingSchemeSchema.safeParse([{ kind: "counter", padWidth: 0 }]).success).toBe(false);
  });
});

describe("renderNumber — surveyed formats reproduce", () => {
  const cases: {
    name: string;
    segments: NumberSegment[];
    context: Parameters<typeof renderNumber>[1];
    value: number;
    expected: string;
  }[] = [
    {
      name: "year4 + counter",
      segments: [{ kind: "year", digits: 4 }, literal("-"), counter(5)],
      context: { openedDate: "2026-03-01" },
      value: 42,
      expected: "2026-00042",
    },
    {
      name: "year2 + counter",
      segments: [{ kind: "year", digits: 2 }, literal("-"), counter(4)],
      context: { openedDate: "2013-11-30" },
      value: 1,
      expected: "13-0001",
    },
    {
      name: "location + year2 + counter",
      segments: [
        { kind: "location_code" },
        literal("-"),
        { kind: "year", digits: 2 },
        literal("-"),
        counter(4),
      ],
      context: { openedDate: "2026-01-01", locationCode: "RENO" },
      value: 103,
      expected: "RENO-26-0103",
    },
    {
      name: "matter type + year4 + counter",
      segments: [
        { kind: "matter_type_code" },
        literal("-"),
        { kind: "year", digits: 4 },
        literal("-"),
        counter(3),
      ],
      context: { openedDate: "2026-01-01", matterTypeCode: "PI" },
      value: 1,
      expected: "PI-2026-001",
    },
    {
      name: "client code + counter",
      segments: [{ kind: "client_code" }, literal("-"), counter(5)],
      context: { openedDate: "2026-01-01", clientCode: "10034" },
      value: 12,
      expected: "10034-00012",
    },
    {
      name: "literal prefix + counter",
      segments: [literal("MC-"), counter(4)],
      context: { openedDate: "2026-01-01" },
      value: 42,
      expected: "MC-0042",
    },
  ];

  for (const { name, segments, context, value, expected } of cases) {
    it(name, () => {
      expect(renderNumber(segments, context, value)).toBe(expected);
    });
  }

  it("renders date_opened as YYYYMMDD", () => {
    expect(renderNumber([{ kind: "date_opened" }], { openedDate: "2026-06-11" }, 0)).toBe(
      "20260611",
    );
  });
});

describe("renderNumber — rendering rules", () => {
  it("zero-pads the counter but never truncates a wider value", () => {
    expect(renderNumber([counter(4)], { openedDate: "2026-01-01" }, 7)).toBe("0007");
    expect(renderNumber([counter(4)], { openedDate: "2026-01-01" }, 123456)).toBe("123456");
  });

  it("sanitizes client_name and staff_initials to URL-safe (spaces dropped, diacritics folded)", () => {
    expect(
      renderNumber(
        [{ kind: "client_name" }],
        { openedDate: "2026-01-01", clientName: "Æon Café" },
        0,
      ),
    ).toBe("AeonCafe");
    expect(
      renderNumber(
        [{ kind: "staff_initials" }],
        { openedDate: "2026-01-01", staffInitials: "J. D. G." },
        0,
      ),
    ).toBe("J.D.G.");
  });

  it("is deterministic — same segments, context, and counter render identically", () => {
    const segments: NumberSegment[] = [{ kind: "year", digits: 4 }, literal("-"), counter(5)];
    const context = { openedDate: "2026-03-01" };
    expect(renderNumber(segments, context, 42)).toBe(renderNumber(segments, context, 42));
  });

  it("always produces a URL-safe number", () => {
    const urlSafe = /^[A-Za-z0-9._~-]+$/;
    const segments: NumberSegment[] = [
      { kind: "client_name" },
      literal("-"),
      { kind: "year", digits: 4 },
      literal("-"),
      counter(4),
    ];
    for (const clientName of ["Acme Corp", "Œuvre & Sons, LLC", "naïve"]) {
      expect(renderNumber(segments, { openedDate: "2026-01-01", clientName }, 5)).toMatch(urlSafe);
    }
  });

  it("refuses a segment whose context value is absent", () => {
    expect(() =>
      renderNumber(
        [{ kind: "location_code", scoping: true }, counter(4)],
        { openedDate: "2026-01-01" },
        1,
      ),
    ).toThrow(NumberingRenderError);
    try {
      renderNumber([{ kind: "client_code" }, counter(4)], { openedDate: "2026-01-01" }, 1);
    } catch (error) {
      expect((error as NumberingRenderError).code).toBe("scheme-segment-value-missing");
    }
  });
});

describe("deriveScopeKey", () => {
  it("is empty for a firm-wide scheme (no scoping segments)", () => {
    expect(
      deriveScopeKey([{ kind: "year", digits: 4 }, counter(5)], { openedDate: "2026-01-01" }),
    ).toBe("");
  });

  it("joins the rendered scoping-segment values in template order", () => {
    const segments: NumberSegment[] = [
      { kind: "location_code", scoping: true },
      literal("-"),
      { kind: "year", digits: 2, scoping: true },
      literal("-"),
      counter(4),
    ];
    expect(deriveScopeKey(segments, { openedDate: "2026-01-01", locationCode: "RENO" })).toBe(
      "RENO:26",
    );
  });

  it("refuses when a scoping segment's value is absent", () => {
    expect(() =>
      deriveScopeKey([{ kind: "client_code", scoping: true }, counter(4)], {
        openedDate: "2026-01-01",
      }),
    ).toThrow(NumberingRenderError);
  });
});
