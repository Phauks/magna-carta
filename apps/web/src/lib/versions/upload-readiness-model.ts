/*
 * The upload readiness report as the version panel shows it: the File storage row it replaces
 * while a live report is on hand, and the one paste a member takes to whoever can act on it.
 *
 * Pure over the report's wire shape (file-manager/upload-readiness-api.ts), like the rest of the
 * panel's models, so the words are testable without a browser and the copy can never disagree
 * with the rows it was taken from.
 */
import {
  UPLOAD_READINESS_CHECK_LABELS,
  type UploadReadinessOutcome,
  type UploadReadinessReport,
} from "$lib/file-manager/upload-readiness-api.ts";
import type { HealthRow } from "./database-health-model.ts";
import { countPill, type SectionPill } from "./version-overlay-model.ts";

/** The heading over the panel's readiness section, which is also its fold toggle's label. */
export const UPLOAD_READINESS_SECTION_LABEL = "Upload readiness";

/** The header line while the check is out, matching the other reads' own. */
export const READINESS_CHECK_IN_FLIGHT_NOTICE = "Checking whether uploads can reach storage";

/** What each outcome is called on screen, and the tint it takes. */
export const UPLOAD_READINESS_OUTCOME_LABELS: Record<UploadReadinessOutcome, string> = {
  ok: "Holds",
  applied: "Applied",
  failed: "Failed",
  "not-applicable": "Not applicable",
};

export function uploadReadinessOutcomeVariant(
  outcome: UploadReadinessOutcome,
): "success" | "info" | "danger" | "neutral" {
  switch (outcome) {
    case "ok":
      return "success";
    case "applied":
      return "info";
    case "failed":
      return "danger";
    case "not-applicable":
      return "neutral";
  }
}

/**
 * One panel row per check, in the report's order — the same row the Database section draws, so
 * the two sections read as one instrument. A check that did not apply is neither healthy nor a
 * fault, and says so in a neutral badge rather than borrowing green for a thing nobody looked at.
 */
export interface UploadReadinessPanelRow extends Omit<HealthRow, "id"> {
  readonly id: string;
  readonly badgeVariant?: "neutral";
}

export function uploadReadinessRows(report: UploadReadinessReport): UploadReadinessPanelRow[] {
  return report.checks.map((check) => ({
    id: check.id,
    name: UPLOAD_READINESS_CHECK_LABELS[check.id],
    reading: check.outcome === "failed" ? "fault" : "healthy",
    status: UPLOAD_READINESS_OUTCOME_LABELS[check.outcome],
    detail: check.detail,
    ...(check.outcome === "not-applicable" ? { badgeVariant: "neutral" as const } : {}),
  }));
}

/** What the shut heading says: how many checks it hides, and how many of them failed. */
export function uploadReadinessSectionPills(report: UploadReadinessReport): SectionPill[] {
  const pills: SectionPill[] = [countPill(report.checks.length, "check")];
  const failed = report.checks.filter((check) => check.outcome === "failed").length;
  if (failed > 0) pills.push({ label: `${String(failed)} not working`, variant: "danger" });
  return pills;
}

/** The first failed check — the cause; what follows it in the report may be consequence. */
export function firstFailedCheck(report: UploadReadinessReport) {
  return report.checks.find((check) => check.outcome === "failed") ?? null;
}

/**
 * The File storage row, from a report taken just now rather than from the last one on record. A
 * live report outranks the audit row the health read carries: it is newer by definition, and it
 * is what the member is looking at.
 */
export function uploadReadinessRow(report: UploadReadinessReport): HealthRow {
  if (report.uploadPath === "through-the-application") {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "healthy",
      status: "Through the application",
      detail: "Files go through the application to its bound storage in this deployment.",
    };
  }
  const failed = firstFailedCheck(report);
  if (failed !== null) {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "fault",
      status: "Not ready",
      detail: `${UPLOAD_READINESS_CHECK_LABELS[failed.id]}: ${failed.detail}`,
    };
  }
  return {
    id: "fileStorage",
    name: "File storage",
    reading: "healthy",
    status: "Ready",
    detail:
      "Files upload straight from the browser to the firm's storage. The upload check just passed.",
  };
}

/** The report as one paste: verdict, the deployment facts, then every check in order. */
export function copyReportForUploadReadiness(report: UploadReadinessReport): string {
  const lines = [
    `Upload readiness: ${report.ready ? "ready" : "not ready"}`,
    `Upload path: ${report.uploadPath === "direct-to-storage" ? "direct to storage" : "through the application"}`,
    `Provisioning adapter: ${report.provisioner}`,
    `Bucket: ${report.bucketName ?? "none recorded"}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `${UPLOAD_READINESS_CHECK_LABELS[check.id]}: ${UPLOAD_READINESS_OUTCOME_LABELS[check.outcome]} — ${check.detail}`,
    );
  }
  return lines.join("\n");
}
