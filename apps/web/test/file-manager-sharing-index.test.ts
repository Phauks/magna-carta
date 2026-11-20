import { describe, expect, it } from "vitest";
import type { ShareSummary } from "../src/lib/file-manager/sharing-api.ts";
import {
  createSharingIndex,
  initialsOf,
  roleItems,
  sharedWithText,
} from "../src/lib/file-manager/sharing-index.ts";

/*
 * The one index every sharing surface reads: the row mark, the Shared With column, the rail, the
 * details panel and the Sharing view. Its rule has to be the server's: a file is seen through its
 * own share and its folder's (or, in no folder, Home's); a folder is never seen through its parent.
 */

let counter = 0;
const share = (over: Partial<ShareSummary>): ShareSummary => {
  counter += 1;
  return {
    id: `share_${counter}`,
    matterId: "matter",
    scope: "file",
    folderId: null,
    fileId: null,
    fileVersionId: null,
    recipientEntityId: "dana",
    recipientName: "Dana Whitfield",
    role: "viewer",
    allowDownload: true,
    signIn: "link",
    endsOn: null,
    sharedByUserId: "user",
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    dormant: null,
    ...over,
  };
};

const pleadingsShare = share({ scope: "folder", folderId: "pleadings" });
const expertShare = share({
  scope: "file",
  fileId: "complaint",
  recipientEntityId: "priya",
  recipientName: "Priya Raman",
  role: "editor",
});
const homeShare = share({
  scope: "matter",
  recipientEntityId: "marcus",
  recipientName: "Marcus Hale",
});
const index = createSharingIndex([pleadingsShare, expertShare, homeShare]);

describe("createSharingIndex", () => {
  it("lists a file's own sharers and its folder's, strongest role first", () => {
    const people = index.peopleWhoSee({ kind: "file", fileId: "complaint", folderId: "pleadings" });
    expect(people.map((person) => person.name)).toEqual(["Priya Raman", "Dana Whitfield"]);
    expect(people[0]?.direct?.id).toBe(expertShare.id);
    expect(people[1]?.direct).toBeNull();
    expect(people[1]?.inherited.map((each) => each.id)).toEqual([pleadingsShare.id]);
  });

  it("lets Home's shares reach only the files in no folder", () => {
    expect(index.isShared({ kind: "file", fileId: "letter", folderId: null })).toBe(true);
    expect(
      index.peopleWhoSee({ kind: "file", fileId: "letter", folderId: null }).map((p) => p.name),
    ).toEqual(["Marcus Hale"]);
    expect(index.isShared({ kind: "file", fileId: "other", folderId: "correspondence" })).toBe(
      false,
    );
  });

  it("never lets a folder be seen through its parent", () => {
    expect(index.isShared({ kind: "folder", folderId: "pleadings" })).toBe(true);
    expect(index.isShared({ kind: "folder", folderId: "drafts-inside-pleadings" })).toBe(false);
  });

  it("answers one person's access to one item", () => {
    const target = { kind: "file", fileId: "motion", folderId: "pleadings" } as const;
    expect(index.accessFor("dana", target)).toEqual({ direct: null, through: pleadingsShare });
    expect(index.accessFor("priya", target)).toEqual({ direct: null, through: null });
  });

  it("lists a share that no longer opens but takes its role from the live ones", () => {
    const ended = share({ scope: "file", fileId: "x", role: "editor", dormant: "ended" });
    const live = share({ scope: "folder", folderId: "f", role: "viewer" });
    const people = createSharingIndex([ended, live]).peopleWhoSee({
      kind: "file",
      fileId: "x",
      folderId: "f",
    });
    expect(people).toHaveLength(1);
    expect(people[0]?.role).toBe("viewer");
    expect(people[0]?.direct?.dormant).toBe("ended");
  });

  it("counts each person's shares on the matter", () => {
    expect(index.people().map((person) => [person.name, person.itemCount])).toEqual([
      ["Dana Whitfield", 1],
      ["Marcus Hale", 1],
      ["Priya Raman", 1],
    ]);
  });
});

describe("the words", () => {
  it("joins the names for the Shared With column, blank when only the firm can see", () => {
    const people = index.peopleWhoSee({ kind: "file", fileId: "complaint", folderId: "pleadings" });
    expect(sharedWithText(people)).toBe("Priya Raman, Dana Whitfield");
    expect(sharedWithText([])).toBe("");
  });

  it("takes initials from the first and last names, skipping titles", () => {
    expect(initialsOf("Dr. Priya Raman")).toBe("PR");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("")).toBe("?");
  });

  it("offers Viewer and Editor, and Commenter only to a share that already holds it", () => {
    expect(roleItems(null).map((item) => item.label)).toEqual(["Viewer", "Editor"]);
    expect(roleItems("commenter").map((item) => item.label)).toEqual([
      "Viewer",
      "Commenter",
      "Editor",
    ]);
  });
});
