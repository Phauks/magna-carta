import { describe, expect, it } from "vitest";
import { storedTabularDocumentSchema } from "../src/renderable.ts";

function documentWithCell(cell: unknown): unknown {
  return {
    title: "Firm Usage",
    generatedAt: "2026-08-31T19:00:00.000Z",
    sections: [{ title: "Storage", headers: ["A", "B"], rows: [["Standard", cell]] }],
  };
}

describe("what the register's schema accepts as a cell", () => {
  it("accepts a healthy number face", () => {
    expect(
      storedTabularDocumentSchema.safeParse(documentWithCell({ text: "41,208", number: 41_208 }))
        .success,
    ).toBe(true);
  });

  // The reason the client must drop a broken number face rather than send it: one such cell fails
  // the WHOLE document, so a single unmeasured figure would cost the member the entire shelf item —
  // and it would do it silently, which is how this went unnoticed.
  it("rejects the whole document for one non-finite number face", () => {
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(
        storedTabularDocumentSchema.safeParse(documentWithCell({ text: "-", number: broken }))
          .success,
      ).toBe(false);
    }
  });
});
