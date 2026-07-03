import { describe, expect, it } from "vitest";
import type { FileVersionId, RepairProvenanceId } from "@magna-carta/identifiers/types";
import { freshFirmDatabase } from "./support/fresh-firm-database.ts";
import {
  recordRepairProvenanceStatement,
  readRepairProvenance,
} from "../src/file-repair-provenance-statements.ts";

describe("file_repair_provenance statements", () => {
  it("records a repair provenance row and reads it back parsed", async () => {
    const db = await freshFirmDatabase();
    const manifest = { items: [{ name: "body", recovered: true, detail: "" }], fullyRecovered: true, synthesized: [] };
    await db.batch([
      recordRepairProvenanceStatement(db, {
        id: "repairProvenance_test0000000000000000001" as RepairProvenanceId,
        fileVersionId: "fileVersion_test0000000000000000001" as FileVersionId,
        operation: "repair",
        fullyRecovered: true,
        manifestJson: JSON.stringify(manifest),
        sourceMediaType: "application/pdf",
        createdAt: "2026-07-03T00:00:00.000Z",
      }),
    ]);
    const read = await readRepairProvenance(db, "fileVersion_test0000000000000000001");
    expect(read).not.toBeNull();
    expect(read?.operation).toBe("repair");
    expect(read?.fullyRecovered).toBe(true);
    expect(read?.manifest).toEqual(manifest);
  });

  it("returns null when a version has no provenance", async () => {
    const db = await freshFirmDatabase();
    expect(await readRepairProvenance(db, "fileVersion_absent00000000000000001")).toBeNull();
  });
});
