import { describe, expect, it } from "vitest";
import type { FolderId } from "@magna-carta/identifiers/types";
import {
  createExhibitSetFromFolder,
  followExhibitSetFolder,
  titleFromFileName,
} from "../src/folder-service.ts";
import { issueExhibitSet } from "../src/issue-service.ts";
import { reorderMembers } from "../src/member-service.ts";
import { readExhibitSet } from "../src/queries.ts";
import { ExhibitValidationError } from "../src/validation.ts";
import {
  MATTER,
  OTHER_MATTER,
  commit,
  migratedDatabase,
  options,
  seedFile,
  type Raw,
} from "./support.ts";

// A set made from a folder, and the draft following its folder: files put in join at the end,
// files taken out leave, and the member's own order is kept.

const FOLDER = "folder_exhibitMotion000000000000000" as FolderId;

function seedFolder(
  raw: Raw,
  id: FolderId = FOLDER,
  matterId = MATTER,
  name = "Motion exhibits",
): void {
  raw.exec(
    `INSERT INTO folder (id, matter_id, parent_folder_id, name, created_at, updated_at) VALUES ('${id}', '${matterId}', NULL, '${name}', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
  );
}

function fileInFolder(raw: Raw, name: string, status: "clean" | "pending" = "clean") {
  const seeded = seedFile(raw, MATTER, name, status);
  raw.exec(`UPDATE file SET folder_id = '${FOLDER}' WHERE id = '${seeded.fileId}'`);
  return seeded.fileId;
}

async function titles(database: ReturnType<typeof migratedDatabase>["database"], setId: string) {
  const set = await readExhibitSet(database, MATTER, setId as never);
  return set?.members.map((member) => `${member.label} ${member.title}`);
}

describe("making a set from a folder", () => {
  it("takes the folder's clean files in name order, titled from their names", async () => {
    const { database, raw } = migratedDatabase();
    seedFolder(raw);
    fileInFolder(raw, "02 Demand letter.pdf");
    fileInFolder(raw, "01 Purchase contract.pdf");
    fileInFolder(raw, "03 Invoice.pdf", "pending");
    seedFile(raw, MATTER, "Not in the folder.pdf");

    const made = await createExhibitSetFromFolder(
      database,
      { matterId: MATTER, folderId: FOLDER },
      options,
    );
    await commit(database, made.effect);
    const set = await readExhibitSet(database, MATTER, made.setId);
    expect(set?.name).toBe("Motion exhibits");
    expect(set?.sourceFolderId).toBe(FOLDER);
    expect(await titles(database, made.setId)).toEqual([
      "A 01 Purchase contract",
      "B 02 Demand letter",
    ]);
  });

  it("refuses a folder on another matter", async () => {
    const { database, raw } = migratedDatabase();
    const other = "folder_exhibitOther0000000000000000" as FolderId;
    seedFolder(raw, other, OTHER_MATTER);
    await expect(
      createExhibitSetFromFolder(database, { matterId: MATTER, folderId: other }, options),
    ).rejects.toMatchObject({ code: "exhibit-unknown-folder" });
  });

  it("titles a file by its name without the extension", () => {
    expect(titleFromFileName("Lease, as amended.docx")).toBe("Lease, as amended");
    expect(titleFromFileName(".profile")).toBe(".profile");
  });
});

describe("following the folder while the set is a draft", () => {
  it("adds new files at the end, drops files taken out, and keeps the member's order", async () => {
    const { database, raw } = migratedDatabase();
    seedFolder(raw);
    const contract = fileInFolder(raw, "A contract.pdf");
    fileInFolder(raw, "B letter.pdf");
    fileInFolder(raw, "C invoice.pdf");
    const made = await createExhibitSetFromFolder(
      database,
      { matterId: MATTER, folderId: FOLDER },
      options,
    );
    await commit(database, made.effect);

    // The member puts the invoice first.
    const [first, second, third] = made.memberIds;
    const reordered = await reorderMembers(
      database,
      MATTER,
      made.setId,
      [third!, first!, second!],
      options,
    );
    await commit(database, reordered.effect);

    // The contract is moved out of the folder, a new file arrives, and one still being scanned waits.
    raw.exec(`UPDATE file SET folder_id = NULL WHERE id = '${contract}'`);
    fileInFolder(raw, "D photographs.pdf");
    fileInFolder(raw, "E recording.pdf", "pending");

    const followed = await followExhibitSetFolder(database, MATTER, made.setId, options);
    expect(followed.removedMemberIds).toEqual([first]);
    expect(followed.addedMemberIds).toHaveLength(1);
    await commit(database, followed.effect);
    expect(await titles(database, made.setId)).toEqual([
      "A C invoice",
      "B B letter",
      "C D photographs",
    ]);

    // Nothing changed since: an empty effect.
    const again = await followExhibitSetFolder(database, MATTER, made.setId, options);
    expect(again.effect.statements).toHaveLength(0);
  });

  it("stops following once the set is issued", async () => {
    const { database, raw } = migratedDatabase();
    seedFolder(raw);
    fileInFolder(raw, "A contract.pdf");
    const made = await createExhibitSetFromFolder(
      database,
      { matterId: MATTER, folderId: FOLDER },
      options,
    );
    await commit(database, made.effect);
    const issued = await issueExhibitSet(
      database,
      MATTER,
      made.setId,
      { disposition: "filed", issuedOn: "2026-11-13", filedCopyFileId: null },
      options,
    );
    await commit(database, issued.effect);
    fileInFolder(raw, "B letter.pdf");
    await expect(followExhibitSetFolder(database, MATTER, made.setId, options)).rejects.toThrow(
      ExhibitValidationError,
    );
    expect(await titles(database, made.setId)).toEqual(["A A contract"]);
  });
});
