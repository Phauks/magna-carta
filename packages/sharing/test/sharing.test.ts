import { describe, expect, it } from "vitest";
import type { ShareId } from "@magna-carta/identifiers/types";
import {
  canAccess,
  canAddFiles,
  listSharedFolderFiles,
  listSharedItems,
  readFileAccess,
} from "../src/share-access.ts";
import { listMatterShares } from "../src/share-reads.ts";
import { changeShare, revokeShare, shareItems, ShareValidationError } from "../src/share-service.ts";
import {
  BILLING,
  CLIENT,
  COLLEAGUE_PERSON,
  DISCOVERY,
  EXPERT,
  HOLDING_MATTER,
  MATTER,
  OTHER_MATTER,
  PLEADINGS,
  REQUESTS,
  commit,
  context,
  migratedDatabase,
  options,
  seedFile,
  seedFirm,
} from "./support.ts";

function setUp() {
  const database = migratedDatabase();
  seedFirm(database.raw);
  const interrogatories = seedFile(database.raw, "Interrogatories.pdf", DISCOVERY);
  const nestedRequest = seedFile(database.raw, "Request One.pdf", REQUESTS);
  const complaint = seedFile(database.raw, "Complaint.pdf", PLEADINGS);
  const topLevel = seedFile(database.raw, "Engagement Letter.pdf", null);
  const otherMatterFile = seedFile(database.raw, "Brown Will.pdf", null, OTHER_MATTER);
  return { database, interrogatories, nestedRequest, complaint, topLevel, otherMatterFile };
}

describe("sharing a folder", () => {
  it("covers the files directly inside it, live, and never the folders inside it", async () => {
    const { database, interrogatories, nestedRequest, complaint } = setUp();
    const { effect } = await shareItems(
      database.database,
      { matterId: MATTER, items: [{ scope: "folder", folderId: DISCOVERY }], people: [{ entityId: CLIENT, role: "viewer" }] },
      options,
    );
    await commit(database.database, effect);

    expect(await canAccess(database.database, CLIENT, interrogatories, "view", context)).toBe(true);
    expect(await canAccess(database.database, CLIENT, nestedRequest, "view", context)).toBe(false);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(false);
    expect(await canAccess(database.database, EXPERT, interrogatories, "view", context)).toBe(false);

    const later = seedFile(database.raw, "Added Later.pdf", DISCOVERY);
    expect(await canAccess(database.database, CLIENT, later, "view", context)).toBe(true);

    const [item] = await listSharedItems(database.database, CLIENT, context);
    expect(item?.name).toBe("Discovery");
    expect(item?.matterTitle).toBe("Alvarez v. Pine Ridge HOA");
    const files = await listSharedFolderFiles(database.database, CLIENT, item!.shareId, context);
    expect(files.map((file) => file.name)).toEqual(["Added Later.pdf", "Interrogatories.pdf"]);
    expect(await listSharedFolderFiles(database.database, EXPERT, item!.shareId, context)).toEqual([]);
  });

  it("shares the matter's top level as the files in no folder", async () => {
    const { database, topLevel, interrogatories } = setUp();
    const { effect } = await shareItems(
      database.database,
      { matterId: MATTER, items: [{ scope: "matter" }], people: [{ entityId: CLIENT, role: "editor" }] },
      options,
    );
    await commit(database.database, effect);
    expect(await canAccess(database.database, CLIENT, topLevel, "edit", context)).toBe(true);
    expect(await canAccess(database.database, CLIENT, interrogatories, "view", context)).toBe(false);
    expect(await canAddFiles(database.database, CLIENT, MATTER, null, context)).toBe(true);
    expect(await canAddFiles(database.database, CLIENT, MATTER, DISCOVERY, context)).toBe(false);
  });
});

describe("roles and download", () => {
  it("lets a viewer read only, and folds two shares to the stronger", async () => {
    const { database, interrogatories } = setUp();
    let result = await shareItems(
      database.database,
      {
        matterId: MATTER,
        items: [{ scope: "folder", folderId: DISCOVERY }],
        people: [{ entityId: EXPERT, role: "viewer" }],
        allowDownload: false,
      },
      options,
    );
    await commit(database.database, result.effect);
    expect(await canAccess(database.database, EXPERT, interrogatories, "comment", context)).toBe(false);
    expect(await canAccess(database.database, EXPERT, interrogatories, "download", context)).toBe(false);

    result = await shareItems(
      database.database,
      {
        matterId: MATTER,
        items: [{ scope: "file", fileId: interrogatories }],
        people: [{ entityId: EXPERT, role: "commenter" }],
        signIn: "twoStep",
      },
      options,
    );
    await commit(database.database, result.effect);
    const access = await readFileAccess(database.database, EXPERT, interrogatories, context);
    expect(access).toMatchObject({ allowed: true, role: "commenter", allowDownload: true, signIn: "twoStep" });
    expect(await canAccess(database.database, EXPERT, interrogatories, "edit", context)).toBe(false);
  });

  it("changes an existing share rather than adding a second one", async () => {
    const { database, interrogatories } = setUp();
    const share = async (role: "viewer" | "editor") => {
      const result = await shareItems(
        database.database,
        { matterId: MATTER, items: [{ scope: "file", fileId: interrogatories }], people: [{ entityId: CLIENT, role }] },
        options,
      );
      await commit(database.database, result.effect);
      return result.shareIds[0];
    };
    const first = await share("viewer");
    const second = await share("editor");
    expect(second).toBe(first);
    const shares = await listMatterShares(database.database, MATTER, context);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ role: "editor", recipientName: "Maria Alvarez", dormant: null });
  });
});

describe("when a share stops opening", () => {
  async function sharedFile() {
    const fixture = setUp();
    const result = await shareItems(
      fixture.database.database,
      {
        matterId: MATTER,
        items: [{ scope: "file", fileId: fixture.complaint }],
        people: [{ entityId: CLIENT, role: "viewer" }],
        endsOn: "2026-11-30",
      },
      options,
    );
    await commit(fixture.database.database, result.effect);
    return { ...fixture, shareId: result.shareIds[0] as ShareId };
  }

  it("refuses on the next request after a revoke", async () => {
    const { database, complaint, shareId } = await sharedFile();
    await commit(database.database, (await revokeShare(database.database, shareId, options)).effect);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(false);
    expect(await listMatterShares(database.database, MATTER, context)).toEqual([]);
  });

  it("refuses after the end date with nothing having swept it, and staff see it as ended", async () => {
    const { database, complaint } = await sharedFile();
    const after = { ...context, today: "2026-12-01" };
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(true);
    expect(await canAccess(database.database, CLIENT, complaint, "view", after)).toBe(false);
    const [record] = await listMatterShares(database.database, MATTER, after);
    expect(record?.dormant).toBe("ended");
  });

  it("refuses once the sharer leaves, and opens again when a colleague takes it over", async () => {
    const { database, complaint, shareId } = await sharedFile();
    database.raw.exec(`UPDATE member SET status = 'deactivated' WHERE user_id = '${options.actorUserId}'`);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(false);
    const [record] = await listMatterShares(database.database, MATTER, context);
    expect(record?.dormant).toBe("needsNewSharer");

    database.raw.exec(`UPDATE member SET status = 'active' WHERE user_id = '${options.actorUserId}'`);
    database.raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_shareParalegal0', 'Pat Paralegal', 'active', '2026-08-01T00:00:00.000Z')`,
    );
    database.raw.exec(
      `INSERT INTO member_role (id, member_user_id, role_id) VALUES ('memberRole_shareTest00000003', 'user_shareParalegal0', 'role_917LCQyRKP50Z9bW89vXl')`,
    );
    database.raw.exec(`UPDATE member SET status = 'deactivated' WHERE user_id = '${options.actorUserId}'`);
    const takeover = await changeShare(
      database.database,
      shareId,
      { role: "viewer" },
      { ...options, actorUserId: "user_shareParalegal0" as typeof options.actorUserId },
    );
    await commit(database.database, takeover.effect);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(true);
  });

  it("is refused for a member whose role cannot share", async () => {
    const { database, complaint } = setUp();
    const result = await shareItems(
      database.database,
      { matterId: MATTER, items: [{ scope: "file", fileId: complaint }], people: [{ entityId: CLIENT, role: "viewer" }] },
      { ...options, actorUserId: BILLING },
    );
    await commit(database.database, result.effect);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(false);
  });

  it("never reaches a deleted file", async () => {
    const { database, complaint } = await sharedFile();
    database.raw.exec(`UPDATE file SET deleted_at = '2026-11-20T10:00:00.000Z' WHERE id = '${complaint}'`);
    expect(await canAccess(database.database, CLIENT, complaint, "view", context)).toBe(false);
    expect(await listSharedItems(database.database, CLIENT, context)).toEqual([]);
  });
});

describe("what a share may name", () => {
  it("refuses an item on another matter, a firm member, and the holding matter", async () => {
    const { database, otherMatterFile, complaint } = setUp();
    const attempt = (input: Parameters<typeof shareItems>[1]) => shareItems(database.database, input, options);
    await expect(
      attempt({ matterId: MATTER, items: [{ scope: "file", fileId: otherMatterFile }], people: [{ entityId: CLIENT, role: "viewer" }] }),
    ).rejects.toMatchObject({ code: "item-unknown" });
    await expect(
      attempt({ matterId: MATTER, items: [{ scope: "file", fileId: complaint }], people: [{ entityId: COLLEAGUE_PERSON, role: "viewer" }] }),
    ).rejects.toMatchObject({ code: "person-is-member" });
    await expect(
      attempt({ matterId: HOLDING_MATTER, items: [{ scope: "matter" }], people: [{ entityId: CLIENT, role: "viewer" }] }),
    ).rejects.toBeInstanceOf(ShareValidationError);
    await expect(
      attempt({ matterId: MATTER, items: [{ scope: "matter" }], people: [{ entityId: CLIENT, role: "viewer" }], endsOn: "next week" }),
    ).rejects.toMatchObject({ code: "ends-on-invalid" });
  });
});
