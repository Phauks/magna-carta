/*
 * The calls behind problem reports, past the filing itself (report.ts): the screenshot the sender
 * attaches, the answer whoever answers the firm's reports gives, the firm's switch for sharing
 * reports with Magna Carta, and the pictures each reader opens.
 *
 * The lists and single reports are read through the generated options in each screen's load; what
 * is here is the writes, and the screenshots, which are bytes rather than a document.
 */
import {
  incidentsAnswer,
  incidentsAttachScreenshot,
  incidentsScreenshot,
  incidentsScreenshotMine,
  incidentsSetSharing,
  platformSharedProblemReportScreenshot,
  type IncidentDetail,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

/** A report's status, as the server names it. */
export type ProblemReportStatus = IncidentDetail["status"];

/** The statuses an answer may set, in the order a report moves through them. */
export const PROBLEM_REPORT_STATUSES: readonly ProblemReportStatus[] = [
  "open",
  "investigating",
  "fixed",
  "closed",
];

/** What each status reads as on screen. `open` is Received: the report arrived and is unanswered. */
export function problemReportStatusLabel(status: ProblemReportStatus): string {
  switch (status) {
    case "open":
      return "Received";
    case "investigating":
      return "Looking Into It";
    case "fixed":
      return "Fixed";
    case "closed":
      return "Closed";
  }
}

/** The permission that reads and answers every report in the firm, and turns sharing on or off. */
export const ANSWER_PROBLEM_REPORTS_PERMISSION = "incidents:viewDescription";

async function outcome<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Attach the covered screenshot to a report the sender just filed. Once only. */
export function attachProblemReportScreenshot(
  incidentId: string,
  imageBase64: string,
): Promise<ApiOutcome<unknown>> {
  return outcome(() =>
    incidentsAttachScreenshot({
      path: { incidentId },
      body: { imageBase64 },
      throwOnError: true,
    }),
  );
}

/** Answer a report: its status, and a note to the sender where there is one. */
export function answerProblemReport(
  incidentId: string,
  status: ProblemReportStatus,
  note: string,
): Promise<ApiOutcome<IncidentDetail>> {
  const kept = note.trim();
  return outcome(() =>
    incidentsAnswer({
      path: { incidentId },
      body: { status, note: kept === "" ? null : kept },
      throwOnError: true,
    }),
  );
}

/** Turn sharing with Magna Carta on or off for the firm. */
export function setProblemReportSharing(
  sharesWithMagnaCarta: boolean,
): Promise<ApiOutcome<{ sharesWithMagnaCarta: boolean }>> {
  return outcome(() => incidentsSetSharing({ body: { sharesWithMagnaCarta }, throwOnError: true }));
}

/** Whose screenshot is being opened, which decides the route that serves it. */
export type ScreenshotReader =
  | { readonly kind: "answerer"; readonly incidentId: string }
  | { readonly kind: "sender"; readonly incidentId: string }
  | { readonly kind: "magna-carta"; readonly firmId: string; readonly incidentId: string };

/**
 * A report's screenshot as an object URL for an `<img>`, or null when it cannot be read. Read as
 * bytes through the client so the session rides it; the caller revokes the URL when it lets go.
 */
export async function readProblemReportScreenshotUrl(
  reader: ScreenshotReader,
): Promise<string | null> {
  try {
    const { data } =
      reader.kind === "answerer"
        ? await incidentsScreenshot({
            path: { incidentId: reader.incidentId },
            parseAs: "blob",
            throwOnError: true,
          })
        : reader.kind === "sender"
          ? await incidentsScreenshotMine({
              path: { incidentId: reader.incidentId },
              parseAs: "blob",
              throwOnError: true,
            })
          : await platformSharedProblemReportScreenshot({
              path: { firmId: reader.firmId, incidentId: reader.incidentId },
              parseAs: "blob",
              throwOnError: true,
            });
    const picture: unknown = data;
    return picture instanceof Blob ? URL.createObjectURL(picture) : null;
  } catch {
    return null;
  }
}
