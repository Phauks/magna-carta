import { describe, expect, it } from "vitest";
import { formatMergeValue, legalFormatsFor } from "../src/format.ts";

const inUtc = { timeZone: "UTC" } as const;

describe("text formatters", () => {
  it("renders plain text unchanged", () => {
    expect(formatMergeValue({ kind: "text", text: "Acme Holdings" }, "plain", inUtc)).toBe(
      "Acme Holdings",
    );
  });

  it("upper-cases", () => {
    expect(formatMergeValue({ kind: "text", text: "Acme Holdings" }, "upper", inUtc)).toBe(
      "ACME HOLDINGS",
    );
  });

  it("title-cases an all-lower or all-upper name without disturbing a correctly mixed one", () => {
    expect(formatMergeValue({ kind: "text", text: "acme holdings" }, "titleCase", inUtc)).toBe(
      "Acme Holdings",
    );
    // A name a paralegal already entered correctly must survive: a naive title-case makes this
    // "O'brien" and "Mccall", which is a visible defect on a filed document.
    expect(formatMergeValue({ kind: "text", text: "O'Brien McCall" }, "titleCase", inUtc)).toBe(
      "O'Brien McCall",
    );
  });
});

describe("date formatters", () => {
  const date = { kind: "date", isoDate: "2026-03-14" } as const;

  it("renders the four named forms", () => {
    expect(formatMergeValue(date, "short", inUtc)).toBe("3/14/2026");
    expect(formatMergeValue(date, "long", inUtc)).toBe("March 14, 2026");
    expect(formatMergeValue(date, "legal", inUtc)).toBe("the 14th day of March, 2026");
    expect(formatMergeValue(date, "iso", inUtc)).toBe("2026-03-14");
  });

  it("uses the right ordinal for the teens and the ones", () => {
    const legalFor = (isoDate: string): string | undefined =>
      formatMergeValue({ kind: "date", isoDate }, "legal", inUtc);
    expect(legalFor("2026-03-01")).toContain("1st");
    expect(legalFor("2026-03-02")).toContain("2nd");
    expect(legalFor("2026-03-03")).toContain("3rd");
    expect(legalFor("2026-03-11")).toContain("11th");
    expect(legalFor("2026-03-12")).toContain("12th");
    expect(legalFor("2026-03-13")).toContain("13th");
    expect(legalFor("2026-03-21")).toContain("21st");
  });

  it("renders an instant in the office's time zone, not the server's", () => {
    // 05:30 UTC on the 15th is still the 14th in Los Angeles. A filing date has to be the date it was in
    // the office that filed it, so the zone is the input, not an afterthought.
    const instant = { kind: "instant", isoInstant: "2026-03-15T05:30:00.000Z" } as const;
    expect(formatMergeValue(instant, "short", { timeZone: "America/Los_Angeles" })).toBe(
      "3/14/2026",
    );
    expect(formatMergeValue(instant, "short", { timeZone: "UTC" })).toBe("3/15/2026");
  });

  it("returns undefined for an unparseable stored date rather than half a string", () => {
    expect(
      formatMergeValue({ kind: "date", isoDate: "not-a-date" }, "long", inUtc),
    ).toBeUndefined();
    expect(
      formatMergeValue({ kind: "instant", isoInstant: "nonsense" }, "long", inUtc),
    ).toBeUndefined();
  });
});

describe("money formatters — integer-exact in both directions", () => {
  it("renders currency from minor units without ever multiplying", () => {
    expect(
      formatMergeValue(
        { kind: "money", amountMinor: 123456, currencyCode: "USD" },
        "currency",
        inUtc,
      ),
    ).toBe("$1,234.56");
  });

  it("moves the decimal point for `plain`, including the awkward small and negative cases", () => {
    const plain = (amountMinor: number): string | undefined =>
      formatMergeValue({ kind: "money", amountMinor, currencyCode: "USD" }, "plain", inUtc);
    expect(plain(0)).toBe("0.00");
    expect(plain(5)).toBe("0.05");
    expect(plain(50)).toBe("0.50");
    expect(plain(500)).toBe("5.00");
    expect(plain(123456)).toBe("1234.56");
    expect(plain(-5)).toBe("-0.05");
  });

  it("round-trips a minor-unit integer through `plain` and back with no drift", () => {
    for (const amountMinor of [0, 1, 99, 100, 101, 999_999, 100_000_000]) {
      const rendered =
        formatMergeValue({ kind: "money", amountMinor, currencyCode: "USD" }, "plain", inUtc) ?? "";
      expect(Math.round(Number(rendered) * 100), String(amountMinor)).toBe(amountMinor);
    }
  });

  it("renders the words form a settlement statement needs", () => {
    const words = (amountMinor: number): string | undefined =>
      formatMergeValue({ kind: "money", amountMinor, currencyCode: "USD" }, "currencyWords", inUtc);
    expect(words(123456)).toBe("one thousand two hundred thirty-four dollars and 56/100");
    expect(words(0)).toBe("zero dollars and 00/100");
    expect(words(5)).toBe("zero dollars and 05/100");
    expect(words(100)).toBe("one dollars and 00/100");
    expect(words(1_500_000)).toBe("fifteen thousand dollars and 00/100");
    expect(words(100_000_000)).toBe("one million dollars and 00/100");
    expect(words(-2500)).toBe("negative twenty-five dollars and 00/100");
  });

  it("treats a rate as scaled by ten thousand and moves the point four places", () => {
    expect(
      formatMergeValue({ kind: "rate", rateE4: 4_500_000, currencyCode: "USD" }, "plain", inUtc),
    ).toBe("450.0000");
    expect(formatMergeValue({ kind: "rate", rateE4: 1, currencyCode: "USD" }, "plain", inUtc)).toBe(
      "0.0001",
    );
  });

  it("returns undefined for a currency the platform does not know", () => {
    expect(
      formatMergeValue({ kind: "money", amountMinor: 100, currencyCode: "XYZ" }, "currency", inUtc),
    ).toBeUndefined();
  });
});

describe("number and boolean formatters", () => {
  it("renders a number", () => {
    expect(formatMergeValue({ kind: "number", value: 42 }, "plain", inUtc)).toBe("42");
  });

  it("renders a boolean both ways", () => {
    expect(formatMergeValue({ kind: "boolean", value: true }, "yesNo", inUtc)).toBe("Yes");
    expect(formatMergeValue({ kind: "boolean", value: false }, "plain", inUtc)).toBe("false");
  });
});

describe("the legal-format table", () => {
  it("keeps money formats off dates and date formats off money", () => {
    expect(legalFormatsFor("date")).not.toContain("currency");
    expect(legalFormatsFor("money")).not.toContain("legal");
  });
});
