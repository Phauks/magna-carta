import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
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

// The Offices screen's contract, driven through the chokepoint over real Miniflare bindings: an
// office with its email and its country-shaped addresses, the register read joining addresses and
// staffing, a member put at an office from the office's side, the firm's default office, and the
// letterhead mark falling back to the firm's primary brand image. Plus the brand images themselves.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let attorneyCookie: string;
let attorneyUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Offices Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("offices-owner@example.com", {
    userName: "Offices Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Offices Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("offices-owner@example.com");

  const attorney = await seedCredentialedUser("offices-attorney@example.com", {
    userName: "Offices Attorney",
    firmId: poolFirmId,
  });
  attorneyUserId = attorney.userId;
  await mirrorMemberWithRole(attorney.userId, "Offices Attorney", poolFirmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("offices-attorney@example.com");
});

function headers(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

function send(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: headers(cookie, true),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
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

async function createOffice(body: Record<string, unknown>): Promise<string> {
  const response = await send("POST", "/api/v1/locations", { name: "Office", ...body });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe("an office's email and country-shaped addresses", () => {
  it("stores the email and answers it on the register and the detail", async () => {
    const id = await createOffice({ name: "Reno", email: "reno@example.com", numberCode: "RNO" });
    const detail = (await (await get(`/api/v1/locations/${id}`)).json()) as {
      email: string | null;
      addresses: unknown[];
      members: unknown[];
      firmDefault: boolean;
      letterheadSource: string;
      createdAt: string;
    };
    expect(detail.email).toBe("reno@example.com");
    expect(detail.addresses).toEqual([]);
    expect(detail.members).toEqual([]);
    expect(detail.firmDefault).toBe(false);
    expect(detail.letterheadSource).toBe("none");
    expect(detail.createdAt).toMatch(/^\d{4}-/);

    const list = (await (await get("/api/v1/locations")).json()) as {
      data: { id: string; email: string | null; members: number; hasLetterheadLogo: boolean }[];
    };
    const row = list.data.find((office) => office.id === id);
    expect(row).toMatchObject({ email: "reno@example.com", members: 0, hasLetterheadLogo: false });
  });

  it("refuses an email that is not one address with a 422", async () => {
    const response = await send("POST", "/api/v1/locations", {
      name: "Bad Mail",
      email: "not an address",
    });
    expect(response.status).toBe(422);
  });

  it("stores every line the international field set has, and joins them onto the register", async () => {
    const id = await createOffice({ name: "Henderson" });
    const set = await send("PUT", `/api/v1/locations/${id}/addresses`, {
      addresses: [
        {
          kind: "physical",
          street: "1 Main St",
          streetTwo: "Suite 200",
          city: "Henderson",
          region: "NV",
          postal: "89002",
          country: "us",
          phone: "+17025550148",
        },
        { kind: "mailing", street: "PO Box 9", city: "Henderson", region: "NV", postal: "89009" },
      ],
    });
    expect(set.status, await set.clone().text()).toBe(200);

    const list = (await (await get("/api/v1/locations")).json()) as {
      data: { id: string; addresses: Record<string, unknown>[] }[];
    };
    const row = list.data.find((office) => office.id === id);
    expect(row?.addresses).toHaveLength(2);
    expect(row?.addresses[0]).toMatchObject({
      kind: "physical",
      streetTwo: "Suite 200",
      // Upper-cased on the way in: a country code is a code, whichever case it was typed in.
      country: "US",
      phone: "+17025550148",
      dependentLocality: null,
      sortingCode: null,
    });
    expect(row?.addresses[1]).toMatchObject({ kind: "mailing", street: "PO Box 9" });
  });
});

describe("staffing an office from the office's side", () => {
  it("puts a member at the office and answers them by name on the detail", async () => {
    const id = await createOffice({ name: "Staffed" });
    const added = await send("PUT", `/api/v1/locations/${id}/members/${attorneyUserId}`, {
      isPrimary: false,
    });
    expect(added.status, await added.clone().text()).toBe(200);

    const detail = (await (await get(`/api/v1/locations/${id}`)).json()) as {
      members: { userId: string; displayName: string; isPrimary: boolean }[];
    };
    // Their first office is their primary whatever the body said.
    expect(detail.members).toEqual([
      {
        userId: attorneyUserId,
        displayName: "Offices Attorney",
        status: "active",
        isPrimary: true,
      },
    ]);

    const list = (await (await get("/api/v1/locations")).json()) as {
      data: { id: string; members: number }[];
    };
    expect(list.data.find((office) => office.id === id)?.members).toBe(1);

    const removed = await send(
      "DELETE",
      `/api/v1/locations/${id}/members/${attorneyUserId}`,
      undefined,
    );
    expect(removed.status, await removed.clone().text()).toBe(200);
    const after = (await (await get(`/api/v1/locations/${id}`)).json()) as { members: unknown[] };
    expect(after.members).toEqual([]);
  });

  it("refuses a member without locations:manage", async () => {
    const id = await createOffice({ name: "Guarded" });
    const refused = await send(
      "PUT",
      `/api/v1/locations/${id}/members/${ownerUserId}`,
      { isPrimary: true },
      attorneyCookie,
    );
    expect(refused.status).toBe(403);
  });
});

describe("the firm's default office", () => {
  it("is set through its own route, marked on every read, and refuses to close", async () => {
    const id = await createOffice({ name: "Head Office" });
    const set = await send("PUT", `/api/v1/locations/${id}/firm-default`, undefined);
    expect(set.status, await set.clone().text()).toBe(200);

    const detail = (await (await get(`/api/v1/locations/${id}`)).json()) as {
      firmDefault: boolean;
    };
    expect(detail.firmDefault).toBe(true);
    const list = (await (await get("/api/v1/locations")).json()) as {
      data: { id: string; firmDefault: boolean }[];
    };
    expect(list.data.find((office) => office.id === id)?.firmDefault).toBe(true);
    expect(list.data.filter((office) => office.firmDefault)).toHaveLength(1);

    const closed = await send("POST", `/api/v1/locations/${id}/close`, undefined);
    expect(closed.status).toBe(409);

    // Handing the role to another office is what lets the first one close.
    const other = await createOffice({ name: "Branch" });
    expect((await send("PUT", `/api/v1/locations/${other}/firm-default`, undefined)).status).toBe(
      200,
    );
    expect((await send("POST", `/api/v1/locations/${id}/close`, undefined)).status).toBe(200);

    // And a closed office cannot take the role back.
    const reclaimed = await send("PUT", `/api/v1/locations/${id}/firm-default`, undefined);
    expect(reclaimed.status).toBe(409);
  });
});

describe("the firm's brand images", () => {
  it("starts empty, holds a primary and additional marks, and streams their bytes", async () => {
    const empty = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      primary: unknown;
      additional: unknown[];
      additionalLimit: number;
    };
    expect(empty.primary).toBeNull();
    expect(empty.additional).toEqual([]);
    expect(empty.additionalLimit).toBeGreaterThan(0);

    const seal = pngFixture(200, 200, 1);
    const set = await send("PUT", "/api/v1/firm/profile/brand-images", {
      imageBase64: base64(seal),
      role: "primary",
    });
    expect(set.status, await set.clone().text()).toBe(200);
    const { sha256 } = (await set.json()) as { sha256: string };
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);

    const wordmark = pngFixture(600, 120, 2);
    const added = await send("PUT", "/api/v1/firm/profile/brand-images", {
      imageBase64: base64(wordmark),
      role: "additional",
      label: "Wordmark",
    });
    expect(added.status, await added.clone().text()).toBe(200);

    const held = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      primary: { sha256: string; widthPixels: number; contentType: string } | null;
      additional: { sha256: string; label: string | null }[];
    };
    expect(held.primary).toMatchObject({ sha256, widthPixels: 200, contentType: "image/png" });
    expect(held.additional).toHaveLength(1);
    expect(held.additional[0]?.label).toBe("Wordmark");

    // Any member reads the bytes: the marks are on every document the firm sends.
    const content = await get(
      `/api/v1/firm/profile/brand-images/${sha256}/content`,
      attorneyCookie,
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(seal);
  });

  it("promotes an additional mark, demoting the primary rather than dropping it", async () => {
    const held = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      primary: { sha256: string };
      additional: { sha256: string }[];
    };
    const promoted = held.additional[0]?.sha256;
    expect(promoted).toBeDefined();
    const patched = await send("PATCH", `/api/v1/firm/profile/brand-images/${promoted ?? ""}`, {
      role: "primary",
    });
    expect(patched.status, await patched.clone().text()).toBe(200);
    const after = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      primary: { sha256: string };
      additional: { sha256: string }[];
    };
    expect(after.primary.sha256).toBe(promoted);
    expect(after.additional.map((image) => image.sha256)).toEqual([held.primary.sha256]);
  });

  it("refuses a write without firm:manageProfile, and a file that is not an image", async () => {
    const refused = await send(
      "PUT",
      "/api/v1/firm/profile/brand-images",
      { imageBase64: base64(pngFixture(10, 10, 3)), role: "additional" },
      attorneyCookie,
    );
    expect(refused.status).toBe(403);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const notAnImage = await send("PUT", "/api/v1/firm/profile/brand-images", {
      imageBase64: base64(svg),
      role: "additional",
    });
    expect(notAnImage.status).toBe(422);
  });

  it("an office with no logo of its own prints the firm's primary mark, until it sets one", async () => {
    const id = await createOffice({ name: "Fallback" });
    const held = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      primary: { sha256: string };
    };
    const primaryBytes = new Uint8Array(
      await (
        await get(`/api/v1/firm/profile/brand-images/${held.primary.sha256}/content`)
      ).arrayBuffer(),
    );

    const detail = (await (await get(`/api/v1/locations/${id}`)).json()) as {
      letterheadSource: string;
      letterheadLogo: unknown;
    };
    expect(detail.letterheadSource).toBe("firm");
    expect(detail.letterheadLogo).toBeNull();

    const fallback = await get(`/api/v1/locations/${id}/letterhead-logo`);
    expect(fallback.status).toBe(200);
    expect(new Uint8Array(await fallback.arrayBuffer())).toEqual(primaryBytes);

    const own = pngFixture(300, 80, 9);
    const set = await send("PUT", `/api/v1/locations/${id}/letterhead-logo`, {
      imageBase64: base64(own),
      printedWidthPoints: 144,
    });
    expect(set.status, await set.clone().text()).toBe(200);
    const after = (await (await get(`/api/v1/locations/${id}`)).json()) as {
      letterheadSource: string;
    };
    expect(after.letterheadSource).toBe("office");
    const ownBytes = await get(`/api/v1/locations/${id}/letterhead-logo`);
    expect(new Uint8Array(await ownBytes.arrayBuffer())).toEqual(own);
  });

  it("removes a mark and sweeps its object", async () => {
    const held = (await (await get("/api/v1/firm/profile/brand-images")).json()) as {
      additional: { sha256: string }[];
    };
    const target = held.additional[0]?.sha256 ?? "";
    const removed = await send("DELETE", `/api/v1/firm/profile/brand-images/${target}`, undefined);
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect((await get(`/api/v1/firm/profile/brand-images/${target}/content`)).status).toBe(404);

    const rows = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS n FROM firm_brand_image WHERE id = ?1")
      .bind(target)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
});
