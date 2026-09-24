import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A member's own picture, through the chokepoint over real Miniflare bindings.
//
// What is worth pinning is what a screen cannot enforce for itself. The bytes decide what they are,
// so nothing but an image can be stored under a member's name. The row and the object agree, so a
// picture that reads back is the picture that was uploaded. And the whole surface is addressed to
// the SESSION's member rather than to a user id in a request, which is what makes a key seeded to
// every default role — including Read-only — safe to hold.

let firmId: FirmId;
let cookie: string;
let userId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const PHOTO_URL = "https://example.com/api/v1/me/photo";
const CONTENT_URL = `${PHOTO_URL}/content`;

interface PhotoBody {
  photo: {
    sha256: string;
    contentType: string;
    sizeBytes: number;
    widthPixels: number;
    heightPixels: number;
    updatedAt: string;
  } | null;
}

// The smallest PNG whose IHDR declares a size — all the image reader needs.
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

function readPhoto(): Promise<Response> {
  return SELF.fetch(PHOTO_URL, { headers: { cookie } });
}

function setPhoto(imageBase64: string): Promise<Response> {
  return SELF.fetch(PHOTO_URL, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify({ imageBase64 }),
  });
}

function removePhoto(): Promise<Response> {
  return SELF.fetch(PHOTO_URL, {
    method: "DELETE",
    headers: { cookie, origin: "https://example.com" },
  });
}

async function storedRow(): Promise<{ sha256: string; object_key: string } | null> {
  return firmDatabase
    .prepare("SELECT sha256, object_key FROM member_photo WHERE member_user_id = ?1")
    .bind(userId)
    .first<{ sha256: string; object_key: string }>();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Own Picture Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  // A Read-only seat deliberately, the member-name precedent: a picture of oneself is not a
  // privilege, and the key it takes reaches every default role. A pass asserted against an
  // administrator would prove nothing about that.
  const member = await seedCredentialedUser("own-picture-member@example.com", {
    userName: "Jane Doe",
    firmId,
  });
  userId = member.userId;
  await mirrorMemberWithRole(member.userId, "Jane Doe", firmId, "Read-only");
  cookie = await signInForSessionCookie("own-picture-member@example.com");
});

describe("a member's own picture", () => {
  it("answers an explicit null before there is one, rather than a 404", async () => {
    const response = await readPhoto();
    expect(response.status).toBe(200);
    expect(((await response.json()) as PhotoBody).photo).toBeNull();
  });

  it("is set from a Read-only seat, because it is one's own", async () => {
    const response = await setPhoto(base64(pngFixture(240, 240)));
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as PhotoBody;
    expect(body.photo?.contentType).toBe("image/png");
    expect(body.photo?.widthPixels).toBe(240);
    expect(body.photo?.heightPixels).toBe(240);
  });

  it("serves the bytes back as the type they were read to be", async () => {
    const response = await SELF.fetch(CONTENT_URL, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // Never publicly cacheable: it rides the session like every other read.
    expect(response.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngFixture(240, 240));
  });

  // The row is what a screen draws from and the object is what it draws — a replacement that moved
  // one and not the other is a member looking at their previous picture indefinitely.
  it("replaces both the row and the object when a second picture is set", async () => {
    const before = await storedRow();
    const response = await setPhoto(base64(pngFixture(120, 60, 7)));
    expect(response.status).toBe(200);
    const after = await storedRow();
    expect(after?.sha256).not.toBe(before?.sha256);
    expect(after?.object_key).not.toBe(before?.object_key);

    const bytes = new Uint8Array(
      await (await SELF.fetch(CONTENT_URL, { headers: { cookie } })).arrayBuffer(),
    );
    expect(bytes).toEqual(pngFixture(120, 60, 7));
  });

  // The row is the ONLY thing that names the object, so a replacement that left the previous bytes
  // behind would leave a photograph of a person in the firm's bucket that nothing could ever find
  // again — neither to draw nor to erase. The object key is read off the row before the upsert
  // overwrites it, and swept after the row is committed.
  it("sweeps the bytes it replaced", async () => {
    await setPhoto(base64(pngFixture(300, 300, 11)));
    const first = await storedRow();
    expect(first).not.toBeNull();

    await setPhoto(base64(pngFixture(300, 300, 12)));
    const second = await storedRow();
    expect(second?.object_key).not.toBe(first?.object_key);
    expect(await env.R2.get(first?.object_key ?? "")).toBeNull();
    expect(await env.R2.get(second?.object_key ?? "")).not.toBeNull();
  });

  // Re-uploading the picture you already hold resolves to the SAME object, because the key is the
  // content's own hash. Sweeping "the old one" there would delete the one the new row points at.
  it("does not sweep when the same bytes are uploaded again", async () => {
    await setPhoto(base64(pngFixture(300, 300, 13)));
    const before = await storedRow();
    await setPhoto(base64(pngFixture(300, 300, 13)));
    const after = await storedRow();
    expect(after?.object_key).toBe(before?.object_key);
    expect(await env.R2.get(after?.object_key ?? "")).not.toBeNull();
  });

  // One row per member is the whole model: a replacement must not leave the previous row beside it,
  // or a roster would have to choose between two pictures of one person.
  it("holds exactly one row however many times a picture is set", async () => {
    const { results } = await firmDatabase
      .prepare("SELECT member_user_id FROM member_photo WHERE member_user_id = ?1")
      .bind(userId)
      .all();
    expect(results).toHaveLength(1);
  });

  it("refuses bytes that are not an image it can draw", async () => {
    const notAnImage = base64(
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    );
    const response = await setPhoto(notAnImage);
    expect(response.status).toBe(422);
    // And the picture that was already there is untouched — a refused upload is not a removal.
    expect(((await (await readPhoto()).json()) as PhotoBody).photo).not.toBeNull();
  });

  it("refuses a field that is not base64 at all", async () => {
    expect((await setPhoto("not base64 ***")).status).toBe(422);
  });

  it("removes the picture, and says what is true afterwards", async () => {
    expect((await removePhoto()).status).toBe(200);
    expect(((await (await readPhoto()).json()) as PhotoBody).photo).toBeNull();
    expect(await storedRow()).toBeNull();
    // The bytes go with the row: nothing else names the object, so leaving it would strand a
    // photograph of a person in the firm's bucket.
    expect((await SELF.fetch(CONTENT_URL, { headers: { cookie } })).status).toBe(404);
  });

  // The act says what is true afterwards rather than what was true before, so a second removal is
  // the same answer rather than a 404 somebody has to handle.
  it("removes idempotently", async () => {
    const response = await removePhoto();
    expect(response.status).toBe(200);
    expect(((await response.json()) as PhotoBody).photo).toBeNull();
  });

  it("refuses an anonymous caller outright", async () => {
    expect((await SELF.fetch(PHOTO_URL)).status).toBe(401);
    expect((await SELF.fetch(CONTENT_URL)).status).toBe(401);
  });
});
