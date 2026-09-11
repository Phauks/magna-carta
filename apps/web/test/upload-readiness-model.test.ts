import { describe, expect, it } from "vitest";
import type { UploadReadinessReport } from "$lib/file-manager/upload-readiness-api.ts";
import {
  copyReportForUploadReadiness,
  firstFailedCheck,
  uploadReadinessRow,
  uploadReadinessRows,
  uploadReadinessSectionPills,
} from "$lib/versions/upload-readiness-model.ts";

const READY: UploadReadinessReport = {
  ready: true,
  bucketName: "magna-carta-production-firm-pemberton",
  provisioner: "cloudflare-rest",
  uploadPath: "direct-to-storage",
  checks: [
    { id: "bucket-recorded", outcome: "ok", detail: "The firm's bucket is recorded." },
    { id: "bucket-exists", outcome: "ok", detail: "It exists in the account." },
    { id: "event-notifications", outcome: "applied", detail: "The notification is in place." },
    { id: "lifecycle-rules", outcome: "applied", detail: "The expiry rules are in place." },
    { id: "cors-policy", outcome: "applied", detail: "The CORS policy is in place." },
    { id: "key-can-sign", outcome: "ok", detail: "The credential is honoured." },
  ],
};

const NOT_READY: UploadReadinessReport = {
  ...READY,
  ready: false,
  checks: READY.checks.map((check) =>
    check.id === "key-can-sign"
      ? {
          ...check,
          outcome: "failed",
          detail: "Storage refused a request signed with the S3 credential (403).",
        }
      : check,
  ),
};

describe("the live File storage row", () => {
  it("reads a ready report as ready, checked just now", () => {
    expect(uploadReadinessRow(READY)).toMatchObject({
      id: "fileStorage",
      reading: "healthy",
      status: "Ready",
    });
  });

  it("names the first failed check as the cause, in the reader's words, with its detail", () => {
    const row = uploadReadinessRow(NOT_READY);
    expect(row).toMatchObject({ reading: "fault", status: "Not ready" });
    expect(row.detail).toContain("The storage credential is honoured");
    expect(row.detail).toContain("403");
    expect(firstFailedCheck(NOT_READY)?.id).toBe("key-can-sign");
  });

  it("says when files go through the application, whatever the checks say", () => {
    expect(uploadReadinessRow({ ...READY, uploadPath: "through-the-application" })).toMatchObject({
      reading: "healthy",
      status: "Through the application",
    });
  });
});

describe("the copyable report", () => {
  it("carries the verdict, the deployment facts, and every check in order with its outcome", () => {
    const text = copyReportForUploadReadiness(NOT_READY);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Upload readiness: not ready");
    expect(lines[1]).toBe("Upload path: direct to storage");
    expect(lines[3]).toBe("Bucket: magna-carta-production-firm-pemberton");
    expect(lines).toHaveLength(4 + NOT_READY.checks.length);
    expect(lines.at(-1)).toContain("The storage credential is honoured: Failed");
    expect(lines.at(-1)).toContain("(403)");
    // No em-dash-as-absence, no emoji: a paste a person forwards.
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("the panel's Upload readiness section", () => {
  it("draws one row per check in the report's order, on the Database section's own row shape", () => {
    const rows = uploadReadinessRows(NOT_READY);
    expect(rows.map((row) => row.id)).toEqual(NOT_READY.checks.map((check) => check.id));
    expect(rows[0]).toMatchObject({
      name: "Storage bucket recorded",
      reading: "healthy",
      status: "Holds",
    });
    expect(rows[2]).toMatchObject({ status: "Applied", reading: "healthy" });
    expect(rows.at(-1)).toMatchObject({ reading: "fault", status: "Failed" });
    expect(rows.at(-1)?.detail).toContain("403");
  });

  it("gives a check that did not apply a neutral badge, never green", () => {
    const local: UploadReadinessReport = {
      ...READY,
      uploadPath: "through-the-application",
      checks: READY.checks.map((check) => ({ ...check, outcome: "not-applicable" })),
    };
    for (const row of uploadReadinessRows(local)) {
      expect(row).toMatchObject({ status: "Not applicable", badgeVariant: "neutral" });
    }
  });

  it("makes the shut heading count the checks and the failures", () => {
    expect(uploadReadinessSectionPills(READY).map((pill) => pill.label)).toEqual(["6 checks"]);
    const pills = uploadReadinessSectionPills(NOT_READY);
    expect(pills.map((pill) => pill.label)).toEqual(["6 checks", "1 not working"]);
    expect(pills[1]?.variant).toBe("danger");
  });
});
