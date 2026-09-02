import { describe, expect, it } from "vitest";
import { ActivityDetails, DETAILED_SOURCE_KEYS } from "$lib/matters/activity-detail.svelte.ts";

/*
 * The detail read behind an activity row. What matters is the failure shape as much as the success
 * one: a subsystem that will not answer must cost its own rows their extra line and nothing else,
 * because the chronology is the screen's subject and the detail is an enrichment of it.
 */

interface StubbedRoute {
  readonly match: string;
  readonly status?: number;
  readonly body: unknown;
}

/** The surface's money formatter, stated here so an assertion reads as a fact rather than a locale. */
const MONEY = { money: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}` };

function stubFetch(routes: readonly StubbedRoute[]): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes.find((candidate) => url.includes(candidate.match));
    const status = route?.status ?? (route === undefined ? 404 : 200);
    return Promise.resolve(
      new Response(JSON.stringify(route?.body ?? {}), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const FILES = {
  match: "/api/v1/files",
  body: {
    data: [
      {
        id: "file_1",
        matterId: "matter_1",
        folderId: null,
        name: "Motion to Dismiss.pdf",
        documentTypeId: null,
        currentVersionId: "version_1",
        createdAt: "2026-08-30T09:00:00.000Z",
        updatedAt: "2026-08-30T09:00:00.000Z",
        versionNumber: 3,
        sizeBytes: 2048,
        sniffedContentType: "application/pdf",
        scanVerdict: "clean",
        status: "clean",
        quarantineReason: null,
      },
      {
        id: "file_2",
        matterId: "matter_1",
        folderId: null,
        name: "Suspect.bin",
        documentTypeId: null,
        currentVersionId: null,
        createdAt: "2026-08-30T09:00:00.000Z",
        updatedAt: "2026-08-30T09:00:00.000Z",
        versionNumber: 1,
        sizeBytes: null,
        sniffedContentType: null,
        scanVerdict: "flagged",
        status: "quarantined",
        quarantineReason: "flagged",
      },
    ],
    nextCursor: null,
  },
};

const NOTES = {
  match: "/notes",
  body: {
    data: [
      {
        id: "note_1",
        matterId: "matter_1",
        authorUserId: "user_1",
        body: "Called the client about the hearing.\nShe asked for a copy of the motion.",
        lastEditedBy: null,
        occurredOn: null,
        occurredAtTime: null,
        timeZone: null,
        documents: [],
        createdAt: "2026-08-30T09:00:00.000Z",
        updatedAt: "2026-08-30T09:00:00.000Z",
      },
    ],
    nextCursor: null,
  },
};

describe("what each subsystem says about its own rows", () => {
  it("names a document and states the facts about it worth the width", async () => {
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, NOTES]), "matter_1", MONEY);

    const document = details.detailFor("documentFiled", "file_1");
    expect(document?.title).toBe("Motion to Dismiss.pdf");
    expect(document?.secondary).toBe("Version 3 · 2.0 KB");
  });

  it("says a document is quarantined, beside it, rather than only in the Files section", async () => {
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, NOTES]), "matter_1", MONEY);
    expect(details.detailFor("documentFiled", "file_2")?.secondary).toBe("Quarantined");
  });

  it("leads a note with its opening line, not its whole body", async () => {
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, NOTES]), "matter_1", MONEY);
    expect(details.detailFor("matterNote", "note_1")?.title).toBe(
      "Called the client about the hearing.",
    );
  });

  it("matches on the row identity the timeline carries, never on a name", async () => {
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, NOTES]), "matter_1", MONEY);
    // Two documents could share a name; the timeline's row id is the file's id, so the join is exact.
    expect(details.detailFor("documentFiled", "file_absent")).toBeUndefined();
    expect(details.detailFor("matterNote", "file_1")).toBeUndefined();
  });

  it("costs a refusing subsystem its own rows and nothing else", async () => {
    // The notes read is behind its own permission. A member who may not read notes still gets the
    // documents named — the chronology is the subject, the detail is an enrichment of it.
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, { ...NOTES, status: 403, body: {} }]), "matter_1", MONEY);
    expect(details.detailFor("documentFiled", "file_1")?.title).toBe("Motion to Dismiss.pdf");
    expect(details.detailFor("matterNote", "note_1")).toBeUndefined();
  });

  it("discards what it holds when the matter changes", async () => {
    const details = new ActivityDetails();
    details.reset("matter_1");
    await details.load(stubFetch([FILES, NOTES]), "matter_1", MONEY);
    expect(details.showing("matter_1")).toBe(true);

    details.reset("matter_2");
    expect(details.showing("matter_2")).toBe(true);
    expect(details.detailFor("documentFiled", "file_1")).toBeUndefined();
  });

  it("names which sources it can say more about, so the next loader has a list to join", () => {
    expect([...DETAILED_SOURCE_KEYS].toSorted()).toEqual([
      "costEntry",
      "documentFiled",
      "matterDeadline",
      "matterEvent",
      "matterNote",
      "timeEntry",
    ]);
  });
});
