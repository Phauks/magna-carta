import { describe, expect, it } from "vitest";
import type { MatterExhibitId } from "@magna-carta/identifiers/types";
import { archiveExhibit, createExhibit, editExhibit } from "../src/exhibit-service.ts";
import { addMembers, removeMember, reorderMembers } from "../src/member-service.ts";
import { listExhibitSets, listMatterExhibits, readExhibitSet } from "../src/queries.ts";
import { referenceNameBaseFor } from "../src/reference-name.ts";
import { createExhibitSet, editExhibitSet } from "../src/set-service.ts";
import { MATTER, OTHER_MATTER, commit, migratedDatabase, options, seedFile } from "./support.ts";

const TITLES = [
  "Employment Agreement of R. Harrington",
  "Letter of Termination",
  "Commercial Lease Agreement",
  "Declaration of Marcus Ortega",
  "Email chain re: vessel inspection",
  "Survey Report",
];

async function setWithSix() {
  const { database, raw } = migratedDatabase();
  const exhibitIds: MatterExhibitId[] = [];
  for (const title of TITLES) {
    const { fileId } = seedFile(raw, MATTER, `${title}.pdf`);
    const created = await createExhibit(database, { matterId: MATTER, fileId, title }, options);
    await commit(database, created.effect);
    exhibitIds.push(created.exhibitId);
  }
  const set = await createExhibitSet(database, { matterId: MATTER, name: "Motion" }, options);
  await commit(database, set.effect);
  const added = await addMembers(database, MATTER, set.setId, exhibitIds, options);
  await commit(database, added.effect);
  return { database, raw, setId: set.setId, exhibitIds, memberIds: added.memberIds };
}

describe("exhibits", () => {
  it("pages the register by cursor without repeating or skipping an exhibit", async () => {
    const { database, exhibitIds } = await setWithSix();
    const first = await listMatterExhibits(database, MATTER, { pageSize: 4 });
    expect(first.data).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const second = await listMatterExhibits(database, MATTER, {
      pageSize: 4,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.nextCursor).toBeNull();
    const seen = [...first.data, ...second.data].map((exhibit) => exhibit.id);
    expect([...seen].sort()).toEqual([...exhibitIds].sort());
  });

  it("mints a reference name once and keeps it across a retitle", async () => {
    const { database, raw } = migratedDatabase();
    const { fileId } = seedFile(raw, MATTER, "lease.pdf");
    const created = await createExhibit(
      database,
      { matterId: MATTER, fileId, title: "Commercial Lease Agreement, 1200 Harbor Way" },
      options,
    );
    await commit(database, created.effect);
    expect(created.referenceName).toBe("commercialLeaseAgreement1200HarborWay");
    const edit = await editExhibit(
      database,
      MATTER,
      created.exhibitId,
      { title: "Lease, as amended" },
      options,
    );
    await commit(database, edit.effect);
    const [exhibit] = (await listMatterExhibits(database, MATTER)).data;
    expect(exhibit?.title).toBe("Lease, as amended");
    expect(exhibit?.referenceName).toBe("commercialLeaseAgreement1200HarborWay");
  });

  it("deduplicates a minted name within the matter with a numeric suffix", async () => {
    const { database, raw } = migratedDatabase();
    const names: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { fileId } = seedFile(raw, MATTER, `photo${index}.jpg`);
      const created = await createExhibit(
        database,
        { matterId: MATTER, fileId, title: "Photograph" },
        options,
      );
      await commit(database, created.effect);
      names.push(created.referenceName);
    }
    expect(names).toEqual(["photograph", "photograph2", "photograph3"]);
    expect(referenceNameBaseFor("1200 Harbor Way")).toBe("exhibit1200HarborWay");
    expect(referenceNameBaseFor("Déclaration")).toBe("declaration");
  });

  it("refuses a file from another matter and a file with no clean version", async () => {
    const { database, raw } = migratedDatabase();
    const elsewhere = seedFile(raw, OTHER_MATTER, "other.pdf");
    await expect(
      createExhibit(database, { matterId: MATTER, fileId: elsewhere.fileId, title: "X" }, options),
    ).rejects.toMatchObject({ code: "exhibit-file-unavailable" });
    const scanning = seedFile(raw, MATTER, "scanning.pdf", "pending");
    await expect(
      createExhibit(database, { matterId: MATTER, fileId: scanning.fileId, title: "X" }, options),
    ).rejects.toMatchObject({ code: "exhibit-file-unavailable" });
  });

  it("refuses a member-supplied reference name another exhibit holds", async () => {
    const { database, raw } = migratedDatabase();
    const first = seedFile(raw, MATTER, "a.pdf");
    await commit(
      database,
      (
        await createExhibit(
          database,
          { matterId: MATTER, fileId: first.fileId, title: "A", referenceName: "keyEmail" },
          options,
        )
      ).effect,
    );
    const second = seedFile(raw, MATTER, "b.pdf");
    await expect(
      createExhibit(
        database,
        { matterId: MATTER, fileId: second.fileId, title: "B", referenceName: "keyEmail" },
        options,
      ),
    ).rejects.toMatchObject({ code: "exhibit-reference-name-taken" });
    await expect(
      createExhibit(
        database,
        { matterId: MATTER, fileId: second.fileId, title: "B", referenceName: "Key Email" },
        options,
      ),
    ).rejects.toMatchObject({ code: "exhibit-reference-name-invalid" });
  });

  it("hides an archived exhibit from the register", async () => {
    const { database, raw } = migratedDatabase();
    const { fileId } = seedFile(raw, MATTER, "a.pdf");
    const created = await createExhibit(
      database,
      { matterId: MATTER, fileId, title: "A" },
      options,
    );
    await commit(database, created.effect);
    await commit(
      database,
      (await archiveExhibit(database, MATTER, created.exhibitId, options)).effect,
    );
    expect((await listMatterExhibits(database, MATTER)).data).toEqual([]);
    expect(
      (await listMatterExhibits(database, MATTER, { includeArchived: true })).data,
    ).toHaveLength(1);
  });
});

describe("draft sets", () => {
  it("labels six members A to F from their positions", async () => {
    const { database, setId } = await setWithSix();
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members.map((member) => member.caption)).toEqual([
      "Exhibit A",
      "Exhibit B",
      "Exhibit C",
      "Exhibit D",
      "Exhibit E",
      "Exhibit F",
    ]);
    expect(set?.members.map((member) => member.title)).toEqual(TITLES);
    const [summary] = (await listExhibitSets(database, MATTER)).data;
    expect(summary?.memberCount).toBe(6);
  });

  it("stores no label while the set is a draft", async () => {
    const { raw } = await setWithSix();
    const labelled = raw
      .prepare("SELECT COUNT(*) AS count FROM exhibit_set_member WHERE label IS NOT NULL")
      .get() as { count: number };
    expect(labelled.count).toBe(0);
  });

  it("reverses a six-member set in one reorder and reports every label that moves", async () => {
    const { database, setId, memberIds } = await setWithSix();
    const reversed = [...memberIds].reverse();
    const result = await reorderMembers(database, MATTER, setId, reversed, options);
    expect(result.moves).toHaveLength(6);
    expect(result.moves[0]).toMatchObject({ memberId: memberIds[5], from: "F", to: "A" });
    await commit(database, result.effect);
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members.map((member) => member.title)).toEqual([...TITLES].reverse());
    expect(set?.members.map((member) => member.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("refuses an order that does not name every member exactly once", async () => {
    const { database, setId, memberIds } = await setWithSix();
    await expect(
      reorderMembers(database, MATTER, setId, memberIds.slice(1), options),
    ).rejects.toMatchObject({ code: "exhibit-order-mismatch" });
  });

  it("refuses a reorder read before a member was added", async () => {
    const { database, raw, setId, memberIds } = await setWithSix();
    const stale = await reorderMembers(database, MATTER, setId, [...memberIds].reverse(), options);
    const { fileId } = seedFile(raw, MATTER, "late.pdf");
    const late = await createExhibit(
      database,
      { matterId: MATTER, fileId, title: "Late" },
      options,
    );
    await commit(database, late.effect);
    await commit(
      database,
      (await addMembers(database, MATTER, setId, [late.exhibitId], options)).effect,
    );
    await expect(commit(database, stale.effect)).rejects.toThrow(/exhibit-order-current/);
  });

  it("closes the gap a removal leaves, so the labels after it move up", async () => {
    const { database, setId, memberIds } = await setWithSix();
    const removal = await removeMember(database, MATTER, setId, memberIds[1]!, options);
    await commit(database, removal.effect);
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members.map((member) => `${member.label}:${member.title}`)).toEqual([
      `A:${TITLES[0]}`,
      `B:${TITLES[2]}`,
      `C:${TITLES[3]}`,
      `D:${TITLES[4]}`,
      `E:${TITLES[5]}`,
    ]);
  });

  it("refuses two members on one position at the database", async () => {
    const { raw, setId, exhibitIds } = await setWithSix();
    expect(() =>
      raw.exec(
        `INSERT INTO exhibit_set_member (id, exhibit_set_id, matter_exhibit_id, position, status, created_at, updated_at) VALUES ('exhibitSetMember_duplicateSlot000000', '${setId}', '${exhibitIds[0]}', 1, 'active', 'x', 'x')`,
      ),
    ).toThrow(/UNIQUE/);
  });

  it("refuses the same exhibit twice in one set", async () => {
    const { database, setId, exhibitIds } = await setWithSix();
    await expect(
      addMembers(database, MATTER, setId, [exhibitIds[0]!], options),
    ).rejects.toMatchObject({ code: "exhibit-already-in-set" });
  });

  it("renumbers every label at once when the scheme changes", async () => {
    const { database, setId } = await setWithSix();
    const edit = await editExhibitSet(
      database,
      MATTER,
      setId,
      { scheme: { sequence: "arabic", startAt: 500, prefix: "D-" } },
      options,
    );
    await commit(database, edit.effect);
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members.map((member) => member.label)).toEqual([
      "D-500",
      "D-501",
      "D-502",
      "D-503",
      "D-504",
      "D-505",
    ]);
  });

  it("refuses a roman scheme that could not number a full set", async () => {
    const { database, setId } = await setWithSix();
    await expect(
      editExhibitSet(
        database,
        MATTER,
        setId,
        { scheme: { sequence: "upperRoman", startAt: 3500 } },
        options,
      ),
    ).rejects.toMatchObject({ code: "exhibit-scheme-out-of-range" });
  });

  it("does not show a set on another matter", async () => {
    const { database, setId } = await setWithSix();
    expect(await readExhibitSet(database, OTHER_MATTER, setId)).toBeUndefined();
  });

  it("shows which sets each exhibit appears in, with its label there", async () => {
    const { database, setId, memberIds, exhibitIds } = await setWithSix();
    await commit(
      database,
      (await reorderMembers(database, MATTER, setId, [...memberIds].reverse(), options)).effect,
    );
    const register = (await listMatterExhibits(database, MATTER)).data;
    const first = register.find((exhibit) => exhibit.id === exhibitIds[0]);
    expect(first?.appearances).toEqual([
      { setId, setName: "Motion", state: "draft", label: "F", status: "active" },
    ]);
  });
});
