import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { DocumentTypeId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  createDocumentType,
  deactivateDocumentType,
  updateDocumentType,
} from "../src/document-type-service.ts";
import { freshDatabase, now, options } from "./support.ts";

async function readType(database: ReturnType<typeof freshDatabase>, id: DocumentTypeId) {
  const { results } = await database
    .prepare("SELECT name, code, active FROM document_type WHERE id = ?1")
    .bind(id)
    .all<{ name: string; code: string | null; active: number }>();
  return results[0];
}

describe("document type service", () => {
  it("creates, renames, and soft-deactivates a document type", async () => {
    const database = freshDatabase();
    const created = await createDocumentType(database, { name: "Pleading", code: "PLD" }, options);
    await commitEffectBatch(database, created.effect, { now });
    expect(await readType(database, created.documentTypeId)).toEqual({
      name: "Pleading",
      code: "PLD",
      active: 1,
    });
    const updated = await updateDocumentType(
      database,
      created.documentTypeId,
      { name: "Court Pleading" },
      options,
    );
    await commitEffectBatch(database, updated.effect, { now });
    expect((await readType(database, created.documentTypeId))?.name).toBe("Court Pleading");
    const deactivated = await deactivateDocumentType(database, created.documentTypeId, options);
    await commitEffectBatch(database, deactivated.effect, { now });
    expect((await readType(database, created.documentTypeId))?.active).toBe(0);
  });

  it("refuses a duplicate name and an unknown type", async () => {
    const database = freshDatabase();
    const first = await createDocumentType(database, { name: "Pleading" }, options);
    await commitEffectBatch(database, first.effect, { now });
    await expect(createDocumentType(database, { name: "Pleading" }, options)).rejects.toMatchObject(
      { code: "document-type-name-taken" },
    );
    await expect(
      deactivateDocumentType(database, "documentType_missing" as DocumentTypeId, options),
    ).rejects.toMatchObject({ code: "unknown-document-type" });
  });
});
