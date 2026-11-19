import { z } from "zod";
import { INCIDENT_STATUSES } from "./incident-statements.ts";

// What the problem-report routes accept and answer, as plain zod. Each component is named with
// zod's own metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so
// the route module in apps/api-worker declares its routes over these without restating a field.

/** The largest screenshot kept. A full-screen PNG of an app page is well under this. */
export const MAX_INCIDENT_SCREENSHOT_BYTES = 4 * 1024 * 1024;

/** The longest answer note. */
export const MAX_INCIDENT_NOTE_LENGTH = 2000;

const IncidentStatusField = z.enum(INCIDENT_STATUSES);

/** One row of a report list: what an answerer scans, and what a sender sees of their own. */
export const IncidentSummary = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    status: IncidentStatusField,
    statusChangedAt: z.string().nullable(),
    reportedBy: z.string(),
    reporterName: z.string().nullable(),
    summary: z.string().nullable(),
    route: z.string().nullable(),
    errorIdCount: z.number().int(),
    hasScreenshot: z.boolean(),
  })
  .meta({ id: "IncidentSummary" });

export const IncidentList = z
  .object({ incidents: z.array(IncidentSummary) })
  .meta({ id: "IncidentList" });

/** One report in full: the sender's words, the answer, and the redacted context it came with. */
export const IncidentDetail = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    status: IncidentStatusField,
    statusChangedAt: z.string().nullable(),
    answeredByName: z.string().nullable(),
    statusNote: z.string().nullable(),
    reportedBy: z.string(),
    reporterName: z.string().nullable(),
    description: z.string().nullable(),
    errorIds: z.array(z.string()),
    breadcrumbs: z.array(z.object({ at: z.string(), action: z.string(), route: z.string() })),
    route: z.string().nullable(),
    appVersion: z.string().nullable(),
    deployment: z.string().nullable(),
    hasScreenshot: z.boolean(),
  })
  .meta({ id: "IncidentDetail" });

export const AnswerIncidentRequest = z
  .object({
    status: IncidentStatusField,
    note: z.string().trim().max(MAX_INCIDENT_NOTE_LENGTH).nullable().optional(),
  })
  .meta({ id: "AnswerIncidentRequest" });

/** Base64 of the image bytes: four characters for every three bytes, plus padding. */
export const AttachIncidentScreenshotRequest = z
  .object({
    imageBase64: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_INCIDENT_SCREENSHOT_BYTES * 4) / 3) + 4),
  })
  .meta({ id: "AttachIncidentScreenshotRequest" });

export type IncidentSummaryValue = z.infer<typeof IncidentSummary>;
export type IncidentDetailValue = z.infer<typeof IncidentDetail>;
