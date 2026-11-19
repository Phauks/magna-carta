import { describe, expect, it } from "vitest";
import {
  cleanText,
  FieldCollector,
  MAX_FIELD_TEXT_LENGTH,
  MAX_FIELDS_PER_FINDING,
  momentOf,
} from "../src/fields.ts";
import { type Finding, withoutFieldValues } from "../src/model.ts";

describe("cleanText", () => {
  it("drops control and direction-override characters and folds whitespace", () => {
    const override = String.fromCharCode(0x202e);
    const popDirection = String.fromCharCode(0x202c);
    expect(cleanText(`  Jane\u0000 ${override}fdp.exe${popDirection}\n\tDoe `)).toBe(
      "Jane fdp.exe Doe",
    );
  });

  it("caps a long value and marks the cut", () => {
    const text = cleanText("a".repeat(MAX_FIELD_TEXT_LENGTH * 10));
    expect(Array.from(text)).toHaveLength(MAX_FIELD_TEXT_LENGTH + 1);
    expect(text.endsWith("…")).toBe(true);
  });

  it("keeps a value at the cap whole", () => {
    expect(cleanText("b".repeat(MAX_FIELD_TEXT_LENGTH))).toBe("b".repeat(MAX_FIELD_TEXT_LENGTH));
  });
});

describe("momentOf", () => {
  it("reads a zoned moment as an instant in canonical form", () => {
    expect(momentOf("2026-10-02T14:31:00Z")).toEqual({
      form: "instant",
      instant: "2026-10-02T14:31:00.000Z",
    });
    expect(momentOf("2026-10-02T10:31:00-04:00")).toEqual({
      form: "instant",
      instant: "2026-10-02T14:31:00.000Z",
    });
  });

  it("reads a moment with no zone as a date and time of day, unconverted", () => {
    expect(momentOf("2026-10-02T14:31:07.25")).toEqual({
      form: "zoneless",
      date: "2026-10-02",
      time: "14:31",
    });
    expect(momentOf("2026-10-02")).toEqual({ form: "zoneless", date: "2026-10-02" });
  });

  it("refuses what is not a real moment", () => {
    expect(momentOf("2026-02-30T00:00:00Z")).toBeUndefined();
    expect(momentOf("2026-10-02T25:00:00Z")).toBeUndefined();
    expect(momentOf("yesterday")).toBeUndefined();
  });
});

describe("withoutFieldValues", () => {
  it("publishes what was found and how much, and none of the values", () => {
    const published = withoutFieldValues({
      category: "identifying-metadata",
      label: "Author, organization, dates, and revision details",
      risk: "high",
      count: 1,
      defaultScrub: true,
      fields: [{ name: "Author", value: { form: "text", text: "Jordan Alvarez" } }],
      unlistedFieldCount: 3,
    });
    expect(published).toEqual({
      category: "identifying-metadata",
      label: "Author, organization, dates, and revision details",
      risk: "high",
      count: 1,
      defaultScrub: true,
    });
    expect(JSON.stringify(published)).not.toContain("Jordan");
  });
});

describe("FieldCollector", () => {
  const finding: Finding = {
    category: "comments",
    label: "Reviewer comments",
    risk: "high",
    count: 1,
    defaultScrub: true,
  };

  it("leaves a finding unchanged when nothing was read", () => {
    expect(new FieldCollector().attachTo(finding)).toBe(finding);
  });

  it("keeps the first fields and counts the rest", () => {
    const fields = new FieldCollector();
    for (let index = 0; index < MAX_FIELDS_PER_FINDING + 7; index++) {
      fields.add({ name: `Reviewer ${index}`, value: { form: "text", text: "x" } });
    }
    const attached = fields.attachTo(finding);
    expect(attached.fields).toHaveLength(MAX_FIELDS_PER_FINDING);
    expect(attached.unlistedFieldCount).toBe(7);
  });
});
