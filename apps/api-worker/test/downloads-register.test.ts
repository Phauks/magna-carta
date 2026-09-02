import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

// The STORED shape: the instant rather than the rendered stamp lines, and cells that keep their
// number face so a re-rendered spreadsheet still carries summable columns.
const document = {
  title: "Firm Usage",
  generatedAt: "2026-08-31T19:57:56.000Z",
  sections: [
    {
      title: "Storage",
      headers: ["Storage Class", "Objects"],
      rows: [["Standard", { text: "41,208", number: 41_208 }]],
      endAlignedColumns: [1],
    },
  ],
};

async function shelfCookie(email: string, name: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: name, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, name, poolFirmId);
  return await signInForSessionCookie(email);
}

async function keepSnapshot(
  cookie: string,
  title: string,
  format = "docx",
  taken = true,
): Promise<string> {
  const response = await SELF.fetch("https://example.com/api/v1/downloads/snapshots", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title, format, taken, document }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string };
  return created.id;
}

interface ShelfItem {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly requestedFormat: string | null;
  readonly downloadedFormats: string[];
  readonly state: string;
}

async function readShelf(cookie: string): Promise<ShelfItem[]> {
  const response = await SELF.fetch("https://example.com/api/v1/downloads", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: ShelfItem[] }).items;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Shelf Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  // A snapshot's document is stored in the firm's bucket, so the seeded firm needs one. "R2" is the
  // bound test namespace, the same name the bundle suites seed.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(poolFirmId, "R2")
    .run();
});

describe("the download register", () => {
  it("refuses an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/downloads");
    expect(response.status).toBe(401);
  });

  it("keeps an export on the member's shelf and lists it back", async () => {
    const cookie = await shelfCookie("shelf-owner@example.com", "Shelf Owner");
    const id = await keepSnapshot(cookie, "Firm Usage");

    const items = await readShelf(cookie);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(id);
    expect(items[0]?.title).toBe("Firm Usage");
    expect(items[0]?.kind).toBe("snapshot");
    // The format taken at the moment it was kept is already on the row — the shelf answers "what
    // has been downloaded", not only "what exists".
    expect(items[0]?.downloadedFormats).toEqual(["docx"]);
    expect(items[0]?.state).toBe("ready");
  });

  it("generates without marking a format taken, which is the default export path", async () => {
    // Exporting no longer saves a file: the item is generated onto the shelf so several can be
    // taken together. The format asked for is remembered, and nothing is claimed as downloaded.
    const cookie = await shelfCookie("shelf-generate@example.com", "Shelf Generate");
    await keepSnapshot(cookie, "Generated Only", "xlsx", false);

    const items = await readShelf(cookie);
    expect(items[0]?.requestedFormat).toBe("xlsx");
    expect(items[0]?.downloadedFormats).toEqual([]);
  });

  it("hands a snapshot back as the stored document and records the second format", async () => {
    const cookie = await shelfCookie("shelf-fetch@example.com", "Shelf Fetch");
    const id = await keepSnapshot(cookie, "Firm Usage", "csv");

    const response = await SELF.fetch(`https://example.com/api/v1/downloads/${id}/fetches`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "xlsx" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; document: typeof document };
    expect(body.kind).toBe("snapshot");
    // The figures come back exactly as they were exported — the document is stored, not recomputed.
    expect(body.document).toEqual(document);

    const items = await readShelf(cookie);
    expect(items[0]?.downloadedFormats).toEqual(["csv", "xlsx"]);
  });

  it("never shows or serves one member's item to another", async () => {
    const owner = await shelfCookie("shelf-a@example.com", "Member A");
    const id = await keepSnapshot(owner, "Private Export");
    const colleague = await shelfCookie("shelf-b@example.com", "Member B");

    expect(await readShelf(colleague)).toEqual([]);
    // The same answer a request for a row that does not exist gets — anything else would confirm
    // the colleague's item is there.
    const response = await SELF.fetch(`https://example.com/api/v1/downloads/${id}/fetches`, {
      method: "POST",
      headers: { cookie: colleague, "content-type": "application/json" },
      body: JSON.stringify({ format: "docx" }),
    });
    expect(response.status).toBe(404);
  });

  it("removes only the caller's own item", async () => {
    const cookie = await shelfCookie("shelf-remove@example.com", "Shelf Remove");
    const id = await keepSnapshot(cookie, "Disposable");

    const removed = await SELF.fetch(`https://example.com/api/v1/downloads/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(removed.status).toBe(204);
    expect(await readShelf(cookie)).toEqual([]);

    // And the stored document goes with the row, so a second fetch cannot resurrect it.
    const refetch = await SELF.fetch(`https://example.com/api/v1/downloads/${id}/fetches`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ format: "docx" }),
    });
    expect(refetch.status).toBe(404);
  });

  it("refuses a document past the register's bounds by name", async () => {
    const cookie = await shelfCookie("shelf-bounds@example.com", "Shelf Bounds");
    const response = await SELF.fetch("https://example.com/api/v1/downloads/snapshots", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Oversized",
        format: "docx",
        document: {
          ...document,
          sections: Array.from({ length: 49 }, (unused, index) => ({
            title: `Section ${index}`,
            headers: ["A"],
            rows: [],
          })),
        },
      }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("emits every register route into the OpenAPI document with its metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const contract = (await response.json()) as {
      paths: Record<string, Record<string, Record<string, unknown>> | undefined>;
    };
    expect(contract.paths["/api/v1/downloads"]?.["get"]?.["x-mc-operationId"]).toBe(
      "downloads.shelf",
    );
    expect(contract.paths["/api/v1/downloads/snapshots"]?.["post"]).toMatchObject({
      "x-mc-permission": "downloads:shelf",
      "x-mc-resource": "firm",
      // An export is firm data leaving in a file, and the register is the first place that act is
      // recorded at all — the printer that renders it stores nothing.
      "x-mc-audited": true,
    });
    expect(
      contract.paths["/api/v1/downloads/{downloadItemId}/fetches"]?.["post"]?.["x-mc-audited"],
    ).toBe(true);
  });
});
