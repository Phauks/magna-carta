import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A directory record's picture, through the chokepoint over real Miniflare bindings.
//
// Pinned here is what a screen cannot enforce for itself: only an image is ever stored, the row and
// the object agree, a replaced picture's object is swept, a record that does not exist cannot be
// given one, and changing a record's picture takes the directory's own edit permission.

let firmId: FirmId;
let ownerCookie: string;
let readerCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let personId: string;

const ORIGIN = "https://example.com";

interface PhotoBody {
  photo: { sha256: string; contentType: string; widthPixels: number; heightPixels: number } | null;
}

// The smallest PNG whose IHDR declares a size, which is all the image reader needs.
function pngFixture(width: number, height: number, salt = 0): Uint8Array {
  const bytes = new Uint8Array(25);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = salt;
  return bytes;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function photoUrl(id: string): string {
  return `${ORIGIN}/api/v1/directory/entities/${id}/photo`;
}

function setPhoto(id: string, imageBase64: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(photoUrl(id), {
    method: "PUT",
    headers: {
      cookie,
      origin: ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ imageBase64 }),
  });
}

function removePhoto(id: string): Promise<Response> {
  return SELF.fetch(photoUrl(id), {
    method: "DELETE",
    headers: { cookie: ownerCookie, origin: ORIGIN, "Idempotency-Key": crypto.randomUUID() },
  });
}

async function storedObjectKey(id: string): Promise<string | null> {
  const row = await firmDatabase
    .prepare("SELECT object_key FROM directory_entity_photo WHERE entity_id = ?1")
    .bind(id)
    .first<{ object_key: string }>();
  return row?.object_key ?? null;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Record Picture Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("record-picture-owner@example.com", {
    userName: "Picture Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Picture Owner", firmId);
  ownerCookie = await signInForSessionCookie("record-picture-owner@example.com");

  const reader = await seedCredentialedUser("record-picture-reader@example.com", {
    userName: "Picture Reader",
    firmId,
  });
  await mirrorMemberWithRole(reader.userId, "Picture Reader", firmId, "Read-only");
  readerCookie = await signInForSessionCookie("record-picture-reader@example.com");

  const created = await SELF.fetch(`${ORIGIN}/api/v1/directory/persons`, {
    method: "POST",
    headers: {
      cookie: ownerCookie,
      origin: ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ given: "Eleanor", family: "Pemberton" }),
  });
  expect(created.status).toBe(201);
  personId = ((await created.json()) as { id: string }).id;
});

describe("a directory record's picture", () => {
  it("answers an explicit null before there is one", async () => {
    const response = await SELF.fetch(photoUrl(personId), { headers: { cookie: ownerCookie } });
    expect(response.status).toBe(200);
    const empty: PhotoBody = await response.json();
    expect(empty.photo).toBeNull();
  });

  it("is set, read back as facts, and served as the bytes it was read to be", async () => {
    const response = await setPhoto(personId, base64(pngFixture(320, 320)));
    expect(response.status, await response.clone().text()).toBe(200);
    const body: PhotoBody = await response.json();
    expect(body.photo?.contentType).toBe("image/png");
    expect(body.photo?.widthPixels).toBe(320);

    const objectKey = await storedObjectKey(personId);
    expect(objectKey?.startsWith(`directory-photo/${personId}/`)).toBe(true);

    const content = await SELF.fetch(`${photoUrl(personId)}/content`, {
      headers: { cookie: readerCookie },
    });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(pngFixture(320, 320));
  });

  it("sweeps the object a replaced picture pointed at", async () => {
    const before = await storedObjectKey(personId);
    const response = await setPhoto(personId, base64(pngFixture(320, 320, 7)));
    expect(response.status).toBe(200);
    const after = await storedObjectKey(personId);
    expect(after).not.toBe(before);
    expect(await env.R2.get(before ?? "")).toBeNull();
    expect(await env.R2.get(after ?? "")).not.toBeNull();
  });

  it("refuses bytes that are not an image", async () => {
    const response = await setPhoto(personId, base64(new TextEncoder().encode("not a picture")));
    expect(response.status).toBe(422);
  });

  it("refuses a record that does not exist", async () => {
    const response = await setPhoto("directoryPerson_missing", base64(pngFixture(10, 10)));
    expect(response.status).toBe(404);
  });

  it("takes the directory's edit permission to change", async () => {
    const response = await setPhoto(personId, base64(pngFixture(10, 10)), readerCookie);
    expect(response.status).toBe(403);
  });

  it("is removed, and a record with none answers the same way", async () => {
    expect((await removePhoto(personId)).status).toBe(200);
    expect(await storedObjectKey(personId)).toBeNull();
    const again = await removePhoto(personId);
    expect(again.status).toBe(200);
    const none: PhotoBody = await again.json();
    expect(none.photo).toBeNull();
  });
});
