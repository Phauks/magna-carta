import { describe, expect, it } from "vitest";
import type { FileVersionId, MatterExhibitId } from "@magna-carta/identifiers/types";
import { correctMember } from "../src/correction-service.ts";
import { createExhibit } from "../src/exhibit-service.ts";
import { issueExhibitSet } from "../src/issue-service.ts";
import { labelFor } from "../src/label.ts";
import { addMembers, removeMember, reorderMembers } from "../src/member-service.ts";
import { readContinuationChain, readExhibitSet } from "../src/queries.ts";
import { createExhibitSet, editExhibitSet } from "../src/set-service.ts";
import { schemeOf, readExhibitSetRow } from "../src/set-statements.ts";
import { continueExhibitSet, supersedeExhibitSet } from "../src/supersession-service.ts";
import { withdrawMember } from "../src/withdrawal-service.ts";
import { MATTER, addVersion, commit, migratedDatabase, options, seedFile } from "./support.ts";

async function issuedSetOfThree() {
  const { database, raw } = migratedDatabase();
  const exhibitIds: MatterExhibitId[] = [];
  const files = [];
  for (const title of ["Lease", "Letter", "Survey"]) {
    const file = seedFile(raw, MATTER, `${title}.pdf`);
    files.push(file);
    const created = await createExhibit(database, { matterId: MATTER, fileId: file.fileId, title }, options);
    await commit(database, created.effect);
    exhibitIds.push(created.exhibitId);
  }
  const set = await createExhibitSet(database, { matterId: MATTER, name: "Motion" }, options);
  await commit(database, set.effect);
  const added = await addMembers(database, MATTER, set.setId, exhibitIds, options);
  await commit(database, added.effect);
  const issue = await issueExhibitSet(
    database,
    MATTER,
    set.setId,
    { disposition: "filed", issuedOn: "2026-03-14" },
    options,
  );
  await commit(database, issue.effect);
  return { database, raw, setId: set.setId, memberIds: added.memberIds, exhibitIds, files };
}

describe("issuing a set", () => {
  it("writes the computed labels, titles and versions, and the stored labels agree with the function", async () => {
    const { database, raw, setId, files } = await issuedSetOfThree();
    const rows = raw
      .prepare(
        `SELECT position, label, title_as_issued, file_version_id_as_issued FROM exhibit_set_member WHERE exhibit_set_id = '${setId}' ORDER BY position`,
      )
      .all() as { position: number; label: string; title_as_issued: string; file_version_id_as_issued: string }[];
    const row = await readExhibitSetRow(database, setId);
    expect(rows.map((member) => member.label)).toEqual(
      rows.map((member) => labelFor(member.position, schemeOf(row!))),
    );
    expect(rows.map((member) => member.title_as_issued)).toEqual(["Lease", "Letter", "Survey"]);
    expect(rows.map((member) => member.file_version_id_as_issued)).toEqual(
      files.map((file) => file.versionId),
    );
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set).toMatchObject({ state: "issued", disposition: "filed", issuedOn: "2026-03-14" });
  });

  it("keeps the version that went out when the file gets a new one", async () => {
    const { database, raw, setId, files } = await issuedSetOfThree();
    addVersion(raw, files[0]!.fileId, "fileVersion_exhibitLater0001" as FileVersionId, 2);
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members[0]?.fileVersionId).toBe(files[0]!.versionId);
  });

  it("refuses to issue again, to reorder, add, remove or renumber, by name", async () => {
    const { database, setId, memberIds, exhibitIds } = await issuedSetOfThree();
    const refused = { code: "exhibit-set-issued" };
    await expect(
      issueExhibitSet(database, MATTER, setId, { disposition: "served", issuedOn: "2026-03-15" }, options),
    ).rejects.toMatchObject(refused);
    await expect(
      reorderMembers(database, MATTER, setId, [...memberIds].reverse(), options),
    ).rejects.toMatchObject(refused);
    await expect(addMembers(database, MATTER, setId, [exhibitIds[0]!], options)).rejects.toMatchObject(refused);
    await expect(removeMember(database, MATTER, setId, memberIds[0]!, options)).rejects.toMatchObject(refused);
    await expect(
      editExhibitSet(database, MATTER, setId, { scheme: { sequence: "arabic" } }, options),
    ).rejects.toMatchObject(refused);
  });

  it("refuses a set with nothing in it", async () => {
    const { database } = migratedDatabase();
    const set = await createExhibitSet(database, { matterId: MATTER, name: "Empty" }, options);
    await commit(database, set.effect);
    await expect(
      issueExhibitSet(database, MATTER, set.setId, { disposition: "filed", issuedOn: "2026-03-14" }, options),
    ).rejects.toMatchObject({ code: "exhibit-set-empty" });
  });

  it("refuses a date that is not a calendar day", async () => {
    const { database } = migratedDatabase();
    await expect(
      issueExhibitSet(database, MATTER, "exhibitSet_x" as never, { disposition: "filed", issuedOn: "2026-02-30" }, options),
    ).rejects.toMatchObject({ code: "exhibit-invalid-input" });
  });
});

describe("the database's freeze", () => {
  it("refuses changing a label or position, adding, removing, or unissuing", async () => {
    const { raw, setId, memberIds, exhibitIds } = await issuedSetOfThree();
    expect(() => raw.exec(`UPDATE exhibit_set_member SET label = 'Z' WHERE id = '${memberIds[0]}'`)).toThrow(/keeps the label/);
    expect(() => raw.exec(`UPDATE exhibit_set_member SET position = 9 WHERE id = '${memberIds[0]}'`)).toThrow(/keeps the label/);
    expect(() => raw.exec(`UPDATE exhibit_set_member SET title_as_issued = 'Other' WHERE id = '${memberIds[0]}'`)).toThrow(/keeps the label/);
    expect(() => raw.exec(`DELETE FROM exhibit_set_member WHERE id = '${memberIds[0]}'`)).toThrow(/cannot lose a member/);
    expect(() =>
      raw.exec(
        `INSERT INTO exhibit_set_member (id, exhibit_set_id, matter_exhibit_id, position, status, created_at, updated_at) VALUES ('exhibitSetMember_lateArrival00000000', '${setId}', '${exhibitIds[0]}', 4, 'active', 'x', 'x')`,
      ),
    ).toThrow(/cannot gain a member/);
    expect(() => raw.exec(`UPDATE exhibit_set SET state = 'draft' WHERE id = '${setId}'`)).toThrow(/cannot be changed or unissued/);
    expect(() => raw.exec(`UPDATE exhibit_set SET start_at = 4 WHERE id = '${setId}'`)).toThrow(/cannot be changed or unissued/);
    expect(() => raw.exec(`DELETE FROM exhibit_set WHERE id = '${setId}'`)).toThrow(/cannot be deleted/);
  });

  it("lets the stamped copy be attached once, later", async () => {
    const { raw, setId } = await issuedSetOfThree();
    const stamped = seedFile(raw, MATTER, "stamped.pdf");
    raw.exec(`UPDATE exhibit_set SET filed_copy_file_id = '${stamped.fileId}' WHERE id = '${setId}'`);
    const other = seedFile(raw, MATTER, "other.pdf");
    expect(() =>
      raw.exec(`UPDATE exhibit_set SET filed_copy_file_id = '${other.fileId}' WHERE id = '${setId}'`),
    ).toThrow(/cannot be changed/);
  });
});

describe("after issue", () => {
  it("withdraws an exhibit and keeps its label", async () => {
    const { database, setId, memberIds } = await issuedSetOfThree();
    await commit(
      database,
      (await withdrawMember(database, MATTER, setId, memberIds[1]!, { basis: "Stipulated out" }, options)).effect,
    );
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members[1]).toMatchObject({ label: "B", status: "withdrawn", withdrawalBasis: "Stipulated out" });
    await expect(
      withdrawMember(database, MATTER, setId, memberIds[1]!, { basis: "again" }, options),
    ).rejects.toMatchObject({ code: "exhibit-member-withdrawn" });
  });

  it("corrects a recorded title beside the as-issued one, without renumbering", async () => {
    const { database, raw, setId, memberIds } = await issuedSetOfThree();
    await commit(
      database,
      (
        await correctMember(
          database,
          MATTER,
          setId,
          memberIds[0]!,
          { title: "Commercial Lease", basis: "Title was mistyped" },
          options,
        )
      ).effect,
    );
    const set = await readExhibitSet(database, MATTER, setId);
    expect(set?.members[0]).toMatchObject({
      label: "A",
      title: "Commercial Lease",
      titleAsIssued: "Lease",
      correctionBasis: "Title was mistyped",
    });
    const audit = raw
      .prepare(`SELECT metadata FROM audit_log WHERE event = 'exhibitSet.memberCorrected'`)
      .get() as { metadata: string };
    expect(audit.metadata).not.toContain("Commercial Lease");
  });

  it("supersedes a set with a draft copy of its active exhibits, once", async () => {
    const { database, raw, setId, memberIds } = await issuedSetOfThree();
    await commit(
      database,
      (await withdrawMember(database, MATTER, setId, memberIds[1]!, { basis: "Out" }, options)).effect,
    );
    const successor = await supersedeExhibitSet(database, MATTER, setId, { name: "Amended Motion" }, options);
    await commit(database, successor.effect);
    const set = await readExhibitSet(database, MATTER, successor.setId);
    expect(set).toMatchObject({ state: "draft", supersedesSetId: setId, name: "Amended Motion" });
    expect(set?.members.map((member) => `${member.label}:${member.title}`)).toEqual(["A:Lease", "B:Survey"]);
    const predecessor = await readExhibitSet(database, MATTER, setId);
    expect(predecessor?.supersededBySetId).toBe(successor.setId);
    await expect(supersedeExhibitSet(database, MATTER, setId, {}, options)).rejects.toMatchObject({
      code: "exhibit-set-already-superseded",
    });
    // Two racing writes both past the read: the partial unique index refuses the second.
    expect(() =>
      raw.exec(
        `INSERT INTO exhibit_set (id, matter_id, name, noun, prefix, sequence, start_at, overflow_form, state, supersedes_set_id, created_at, updated_at) VALUES ('exhibitSet_racingFork0000000000000', '${MATTER}', 'Fork', 'Exhibit', '', 'upperLetter', 1, 'doubled', 'draft', '${setId}', 'x', 'x')`,
      ),
    ).toThrow(/UNIQUE/);
  });

  it("continues numbering past every consumed label, withdrawn ones included", async () => {
    const { database, setId, memberIds } = await issuedSetOfThree();
    await commit(
      database,
      (await withdrawMember(database, MATTER, setId, memberIds[2]!, { basis: "Out" }, options)).effect,
    );
    const trial = await continueExhibitSet(database, MATTER, setId, { name: "Trial" }, options);
    await commit(database, trial.effect);
    const row = await readExhibitSetRow(database, trial.setId);
    expect(row?.start_at).toBe(4);
    expect(labelFor(1, schemeOf(row!))).toBe("D");
    const chain = await readContinuationChain(database, trial.setId);
    expect(chain.map((set) => set.id)).toEqual([setId]);
  });

  it("refuses to supersede or continue a draft", async () => {
    const { database } = migratedDatabase();
    const set = await createExhibitSet(database, { matterId: MATTER, name: "Draft" }, options);
    await commit(database, set.effect);
    await expect(supersedeExhibitSet(database, MATTER, set.setId, {}, options)).rejects.toMatchObject({
      code: "exhibit-set-not-issued",
    });
    await expect(
      continueExhibitSet(database, MATTER, set.setId, { name: "X" }, options),
    ).rejects.toMatchObject({ code: "exhibit-set-not-issued" });
  });
});
