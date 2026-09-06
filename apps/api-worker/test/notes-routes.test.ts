import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The matter note's route surface, driven through the chokepoint over real Miniflare bindings.
//
// The first case is the one this suite exists for. A matter with NO notes must answer the uniform
// { data, nextCursor } envelope with an empty array — not an empty body, not a bare array, not a
// 404. The screen's paged-list helper spreads `value.data` into its rows and leaves the list on its
// skeleton until something lands there, so a body missing that key is a section that never settles,
// which reads to a person exactly like a firm whose record cannot be read at all. Nothing here
// enforced the empty-page shape before; now the shape a settled list depends on is pinned.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: string;

const clock = { now: () => new Date().toISOString() };

function authHeaders(cookie: string, idempotencyKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
  };
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function post(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, crypto.randomUUID()),
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, crypto.randomUUID()),
    body: JSON.stringify(body),
  });
}

async function remove(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, crypto.randomUUID()),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Notes Test Firm" })).firmId;
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("notes-owner@example.com", {
    userName: "Notes Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Notes Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("notes-owner@example.com");

  const created = await post("/api/v1/matters", {
    title: "Herrera v Alvarez",
    status: "consultation",
    responsibleMemberId: ownerUserId,
  });
  expect(created.status).toBe(201);
  ({ matterId } = (await created.json()) as { matterId: string });
});

describe("a matter with no notes", () => {
  it("answers the uniform envelope with an empty array, so the screen can settle", async () => {
    const response = await get(`/api/v1/matters/${matterId}/notes`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; nextCursor: string | null };
    // Both keys present and of the right shape. The screen spreads `data`, so its absence is not a
    // cosmetic difference — it is an exception in an unobserved promise.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it("answers the same shape when a search matches nothing", async () => {
    const response = await get(`/api/v1/matters/${matterId}/notes?search=nothingmatchesthis`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe("writing, editing and deleting a note", () => {
  it("writes one, reads it back with its author and words, and carries no documents", async () => {
    const created = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "Spoke to Mrs Herrera. She is thinking about the offer.",
    });
    expect(created.status).toBe(201);

    const listed = await get(`/api/v1/matters/${matterId}/notes`);
    const body = (await listed.json()) as {
      data: {
        id: string;
        body: string;
        authorUserId: string;
        lastEditedBy: string | null;
        occurredOn: string | null;
        documents: unknown[];
      }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.body).toContain("Mrs Herrera");
    expect(body.data[0]?.authorUserId).toBe(ownerUserId);
    expect(body.data[0]?.lastEditedBy).toBeNull();
    expect(body.data[0]?.occurredOn).toBeNull();
    expect(body.data[0]?.documents).toEqual([]);
  });

  it("records when the thing happened, separately from when it was typed", async () => {
    const created = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "Call with opposing counsel.",
      occurredOn: "2026-08-25",
      occurredAtTime: "15:30",
      timeZone: "America/Los_Angeles",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const listed = await get(`/api/v1/matters/${matterId}/notes`);
    const body = (await listed.json()) as {
      data: {
        id: string;
        occurredOn: string | null;
        occurredAtTime: string | null;
        createdAt: string;
      }[];
    };
    const note = body.data.find((row) => row.id === id);
    expect(note?.occurredOn).toBe("2026-08-25");
    expect(note?.occurredAtTime).toBe("15:30");
    // The typing instant is its own fact and is not the occurrence.
    expect(note?.createdAt.slice(0, 10)).not.toBe("2026-08-25");
  });

  it("refuses a time with no date, and a wall clock with no zone", async () => {
    const noDate = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "A time nobody can place.",
      occurredAtTime: "15:30",
    });
    expect(noDate.status).toBe(422);

    const noZone = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "A clock with no zone.",
      occurredOn: "2026-08-25",
      occurredAtTime: "15:30",
    });
    expect(noZone.status).toBe(422);
  });

  it("edits in place and records who changed it", async () => {
    const created = await post(`/api/v1/matters/${matterId}/notes`, { body: "The first words." });
    const { id } = (await created.json()) as { id: string };

    const edited = await patch(`/api/v1/notes/${id}`, { body: "The replacement words." });
    expect(edited.status).toBe(200);

    const listed = await get(`/api/v1/matters/${matterId}/notes`);
    const body = (await listed.json()) as {
      data: { id: string; body: string; lastEditedBy: string | null }[];
    };
    const note = body.data.find((row) => row.id === id);
    expect(note?.body).toBe("The replacement words.");
    expect(note?.lastEditedBy).toBe(ownerUserId);
  });

  it("deletes outright, and the note stops being readable", async () => {
    const created = await post(`/api/v1/matters/${matterId}/notes`, { body: "Words that go." });
    const { id } = (await created.json()) as { id: string };

    const deleted = await remove(`/api/v1/notes/${id}`);
    expect(deleted.status).toBe(200);

    const listed = await get(`/api/v1/matters/${matterId}/notes`);
    const body = (await listed.json()) as { data: { id: string }[] };
    expect(body.data.some((row) => row.id === id)).toBe(false);
  });
});

describe("the documents a note points at", () => {
  it("attaches one of the matter's files, and detaching leaves the file alone", async () => {
    const fileId = `file_${crypto.randomUUID().replaceAll("-", "").slice(0, 21)}`;
    await firmDatabase
      .prepare(
        "INSERT INTO file (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) " +
          "VALUES (?1, ?2, NULL, ?3, NULL, NULL, NULL, ?4, ?4)",
      )
      .bind(fileId, matterId, "engagement-letter.pdf", clock.now())
      .run();

    const created = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "Sent the engagement letter.",
    });
    const { id: noteId } = (await created.json()) as { id: string };

    const attached = await post(`/api/v1/notes/${noteId}/documents`, { fileId });
    expect(attached.status).toBe(201);
    const { id: attachmentId } = (await attached.json()) as { id: string };

    const listed = await get(`/api/v1/matters/${matterId}/notes`);
    const body = (await listed.json()) as {
      data: { id: string; documents: { id: string; fileName: string }[] }[];
    };
    const note = body.data.find((row) => row.id === noteId);
    expect(note?.documents).toHaveLength(1);
    // The name comes from the matter's own file record rather than a second copy that could drift.
    expect(note?.documents[0]?.fileName).toBe("engagement-letter.pdf");

    const detached = await remove(`/api/v1/note-documents/${attachmentId}`);
    expect(detached.status).toBe(200);

    const { results } = await firmDatabase
      .prepare("SELECT id FROM file WHERE id = ? AND deleted_at IS NULL")
      .bind(fileId)
      .all();
    expect(results).toHaveLength(1);
  });
});

describe("one note by its id", () => {
  it("reads the note a deep link names, with its documents, and refuses an id nothing holds", async () => {
    const created = await post(`/api/v1/matters/${matterId}/notes`, {
      body: "Opened from the chronology.",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const read = await get(`/api/v1/notes/${id}`);
    expect(read.status).toBe(200);
    const note = (await read.json()) as {
      id: string;
      matterId: string;
      body: string;
      authorUserId: string;
      documents: unknown[];
    };
    expect(note.id).toBe(id);
    expect(note.matterId).toBe(matterId);
    expect(note.body).toBe("Opened from the chronology.");
    expect(note.authorUserId).toBe(ownerUserId);
    expect(note.documents).toEqual([]);

    // Not found, never partially shown: the same answer for a note that does not exist and for one
    // on a matter the member may not see. A well-formed id nothing holds, so the refusal is the
    // read's and not the validator's.
    const unknown = `${id.slice(0, -1)}${id.endsWith("a") ? "b" : "a"}`;
    const missing = await get(`/api/v1/notes/${unknown}`);
    expect(missing.status).toBe(404);

    const removed = await remove(`/api/v1/notes/${id}`);
    expect(removed.status).toBe(200);
  });
});
