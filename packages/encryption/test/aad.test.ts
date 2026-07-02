import { describe, expect, it } from "vitest";

import { type AadContext, serializeAad } from "../src/aad.ts";

import goldenVectors from "./golden/aad-vectors.json" with { type: "json" };

interface GoldenVector {
  readonly context: AadContext;
  readonly expected: string;
}

const vectors = goldenVectors as readonly GoldenVector[];

const baseContext: AadContext = {
  firmId: "firm_base",
  table: "matter",
  field: "notes",
  rowPrimaryKey: "matter_0001",
  algoVersion: 1,
  keyVersion: 1,
};

describe("serializeAad", () => {
  it.each(vectors)("produces the frozen canonical string for $expected", (vector) => {
    const bytes = serializeAad(vector.context);

    // Pins the exact decoded string.
    expect(new TextDecoder().decode(bytes)).toBe(vector.expected);

    // Pins the exact raw bytes.
    expect(bytes).toEqual(new TextEncoder().encode(vector.expected));
  });

  it("is deterministic — the same context yields byte-identical output", () => {
    const first = serializeAad(baseContext);
    const second = serializeAad(baseContext);

    expect(first).toEqual(second);
  });

  describe("every component is bound — varying any one changes the bytes", () => {
    const decoder = new TextDecoder();
    const base = decoder.decode(serializeAad(baseContext));

    const variations: ReadonlyArray<readonly [string, AadContext]> = [
      ["firmId", { ...baseContext, firmId: "firm_other" }],
      ["table", { ...baseContext, table: "client" }],
      ["field", { ...baseContext, field: "summary" }],
      ["rowPrimaryKey", { ...baseContext, rowPrimaryKey: "matter_0002" }],
      ["algoVersion", { ...baseContext, algoVersion: 2 }],
      ["keyVersion", { ...baseContext, keyVersion: 2 }],
    ];

    it.each(variations)("changing %s changes the bytes", (_component, context) => {
      expect(decoder.decode(serializeAad(context))).not.toBe(base);
    });
  });
});
