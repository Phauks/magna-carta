import { describe, expect, it } from "vitest";
import type { RemovalKind } from "@magna-carta/disarm";
import { disarmedCopyName, removalRows } from "../src/lib/tools/file-workbench/disarm-reading.ts";

describe("removalRows", () => {
  it("names every kind the engine reports", () => {
    const kinds: RemovalKind[] = [
      "script",
      "automaticAction",
      "externalAction",
      "embeddedFile",
      "embeddedObject",
      "control",
      "dynamicForm",
      "activeContent",
      "externalLink",
      "dynamicField",
      "customInterface",
      "pictureMetadata",
      "animationFlattened",
    ];
    for (const row of removalRows(kinds.map((kind) => ({ kind, count: 1 })))) {
      expect(row.name).not.toBe(row.kind);
    }
  });

  it("keeps the engine's order and counts", () => {
    expect(
      removalRows([
        { kind: "script", count: 1 },
        { kind: "dynamicField", count: 3 },
      ]),
    ).toEqual([
      { kind: "script", name: "Scripts and macros", count: 1 },
      { kind: "dynamicField", name: "Fields and formulas that run commands", count: 3 },
    ]);
  });
});

describe("disarmedCopyName", () => {
  it("takes the engine's extension when the kind of file changed", () => {
    expect(disarmedCopyName("Engagement Letter.docm", "docx")).toBe(
      "Engagement Letter (disarmed).docx",
    );
  });

  it("keeps the original extension otherwise", () => {
    expect(disarmedCopyName("Production 0007.pdf", null)).toBe("Production 0007 (disarmed).pdf");
    expect(disarmedCopyName("scan", null)).toBe("scan (disarmed)");
  });
});
