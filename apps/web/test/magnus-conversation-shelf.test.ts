import { describe, expect, it } from "vitest";
import type { ApiOutcome, Page } from "../src/lib/api/request.ts";
import {
  ConversationShelf,
  GENERAL_SECTION,
  PINNED_SECTION,
  type ShelfFilter,
} from "../src/lib/magnus/conversation-shelf.svelte.ts";
import type { MagnusConversation, MagnusFolder } from "../src/lib/magnus/magnus-api.ts";

const STARTED_AT = "2026-11-10T09:00:00.000Z";

function conversation(id: string, folderId: string | null = null): MagnusConversation {
  return {
    id,
    title: id,
    createdBy: "member-1",
    matterId: null,
    state: "active",
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
    folderId,
    pinnedAt: null,
  };
}

const FOLDERS: MagnusFolder[] = [
  { id: "folder-a", name: "Leases", createdAt: STARTED_AT, updatedAt: STARTED_AT },
  { id: "folder-b", name: "Research", createdAt: STARTED_AT, updatedAt: STARTED_AT },
];

/** A server that answers the folder list, and records which section reads were made. */
function harness(): { shelf: ConversationShelf; reads: string[] } {
  const reads: string[] = [];
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ data: FOLDERS }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  const reader = (filter: ShelfFilter) => (): Promise<ApiOutcome<Page<MagnusConversation>>> => {
    const section = "pinned" in filter ? PINNED_SECTION : filter.folder;
    reads.push(section);
    const rows =
      section === PINNED_SECTION
        ? [conversation("pinned-1")]
        : [conversation(`in-${section}`, section)];
    return Promise.resolve({ kind: "ok", value: { data: rows, nextCursor: null } });
  };
  return { shelf: new ConversationShelf(fakeFetch, reader), reads };
}

describe("the member's shelf of folders and pins", () => {
  it("reads the folders and Pinned, and no folder's rows until it is opened", async () => {
    const { shelf, reads } = harness();
    await shelf.reload("screen:date");

    expect(shelf.folders?.map((folder) => folder.name)).toEqual(["Leases", "Research"]);
    expect(shelf.pinned.items?.map((row) => row.id)).toEqual(["pinned-1"]);
    // Folders start folded, so a member with many folders pays only for the ones they open.
    expect(reads).toEqual([PINNED_SECTION]);
    expect(shelf.openSections).toEqual([PINNED_SECTION, GENERAL_SECTION]);
  });

  it("reads a folder's own rows, in the server's order, when its section is first opened", async () => {
    const { shelf, reads } = harness();
    await shelf.reload("screen:date");

    shelf.setOpen([PINNED_SECTION, GENERAL_SECTION, "folder-a"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toEqual([PINNED_SECTION, "folder-a"]);
    expect(shelf.listFor("folder-a").items?.map((row) => row.id)).toEqual(["in-folder-a"]);

    // Folding and opening it again does not read it twice.
    shelf.setOpen([GENERAL_SECTION]);
    shelf.setOpen([GENERAL_SECTION, "folder-a"]);
    expect(reads).toEqual([PINNED_SECTION, "folder-a"]);
  });

  it("finds a conversation in whichever section last read it", async () => {
    const { shelf } = harness();
    await shelf.reload("screen:date");
    shelf.setOpen([GENERAL_SECTION, "folder-b"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(shelf.find("pinned-1")?.id).toBe("pinned-1");
    expect(shelf.find("in-folder-b")?.folderId).toBe("folder-b");
    expect(shelf.find("nowhere")).toBeUndefined();
  });

  it("reads every open folder again on a reload, and leaves folded ones alone", async () => {
    const { shelf, reads } = harness();
    await shelf.reload("screen:date");
    shelf.setOpen([PINNED_SECTION, GENERAL_SECTION, "folder-a"]);
    await Promise.resolve();
    reads.length = 0;

    await shelf.reload("screen:name");
    expect(reads.toSorted()).toEqual([PINNED_SECTION, "folder-a"].toSorted());
  });
});
