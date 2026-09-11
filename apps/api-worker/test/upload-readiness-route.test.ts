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

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (
    await seedFirm({ name: "Upload Readiness Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("POST /api/v1/firm/upload-readiness", () => {
  it("answers the session firm's report — under the test pool, the development shape", async () => {
    const { userId } = await seedCredentialedUser("upload-readiness-owner@example.com", {
      userName: "Readiness Owner",
      firmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Readiness Owner", firmId);
    const cookie = await signInForSessionCookie("upload-readiness-owner@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm/upload-readiness", {
      method: "POST",
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      ready: boolean;
      provisioner: string;
      uploadPath: string;
      checks: { id: string; outcome: string }[];
    };
    // The pool carries no Cloudflare credentials, so the development adapter and the development
    // upload path are what the report must SAY it found — never "ok" for checks it could not make.
    expect(report.provisioner).toBe("development");
    expect(report.uploadPath).toBe("through-the-application");
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "bucket-recorded",
      "bucket-exists",
      "event-notifications",
      "lifecycle-rules",
      "cors-policy",
      "key-can-sign",
    ]);
    expect(
      report.checks.filter((check) => check.outcome === "ok").map((check) => check.id),
    ).toEqual(["bucket-recorded"]);
  });

  it("refuses a member without firm:manageScanPolicy", async () => {
    await seedCredentialedUser("upload-readiness-member@example.com", {
      userName: "No Permission",
      firmId,
    });
    const cookie = await signInForSessionCookie("upload-readiness-member@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm/upload-readiness", {
      method: "POST",
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });
});
