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

// The firm's deleted-file policy: a fresh firm reads 30 days then archive; an owner can change it,
// sparsely; a value outside the closed lists is refused. Nothing here destroys a file.

let firmId: FirmId;
let ownerCookie: string;
const URL_PATH = "https://example.com/api/v1/firm/deleted-file-policy";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Deleted Files Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  const { userId } = await seedCredentialedUser("deleted-policy@example.com", {
    userName: "Policy Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Policy Owner", firmId);
  ownerCookie = await signInForSessionCookie("deleted-policy@example.com");
});

function patch(body: unknown): Promise<Response> {
  return SELF.fetch(URL_PATH, {
    method: "PATCH",
    headers: {
      cookie: ownerCookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

describe("the deleted-file policy routes", () => {
  it("reads the default for a firm that never set it", async () => {
    const response = await SELF.fetch(URL_PATH, { headers: { cookie: ownerCookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trashDays: 30, afterTrash: "archive" });
  });

  it("changes one field and leaves the other", async () => {
    const response = await patch({ trashDays: 90 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trashDays: 90, afterTrash: "archive" });
    const reread = await SELF.fetch(URL_PATH, { headers: { cookie: ownerCookie } });
    expect(await reread.json()).toEqual({ trashDays: 90, afterTrash: "archive" });
  });

  it("refuses a window outside the list", async () => {
    const response = await patch({ trashDays: 7 });
    expect(response.status).toBe(422);
  });
});
