import { z } from "zod";
import { capped, paginated } from "@magna-carta/data-access/pagination-contract";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  BATES_PURPOSES,
  MAX_BATES_NUMBER,
  MAX_DIGITS,
  MAX_LOG_NAME_LENGTH,
  MAX_PAGES_PER_RANGE,
  MAX_PREFIX_LENGTH,
  MIN_DIGITS,
} from "./types.ts";

// The Bates contract: request bodies and responses, as plain zod named with `.meta({ id })`. Path
// and query parameters stay with the routes in apps/api-worker. The service re-validates every
// field.

export const CreateBatesLogRequest = z
  .object({
    name: z.string().min(1).max(MAX_LOG_NAME_LENGTH),
    prefix: z.string().max(MAX_PREFIX_LENGTH),
    digits: z.number().int().min(MIN_DIGITS).max(MAX_DIGITS),
  })
  .meta({ id: "CreateBatesLogRequest" });

export const RenameBatesLogRequest = z
  .object({ name: z.string().min(1).max(MAX_LOG_NAME_LENGTH) })
  .meta({ id: "RenameBatesLogRequest" });

export const BatesLogRecord = z
  .object({
    id: identifierField("batesLog"),
    name: z.string(),
    prefix: z.string(),
    digits: z.number().int(),
  })
  .meta({ id: "BatesLogRecord" });

export const TakeBatesRangeRequest = z
  .object({
    logId: identifierField("batesLog"),
    pageCount: z.number().int().min(1).max(MAX_PAGES_PER_RANGE),
    // Absent takes the next number in the log.
    firstNumber: z.number().int().min(0).max(MAX_BATES_NUMBER).optional(),
    purpose: z.enum(BATES_PURPOSES),
    sourceFileId: identifierField("file").nullable().optional(),
    exhibitSetId: identifierField("exhibitSet").nullable().optional(),
  })
  .meta({ id: "TakeBatesRangeRequest" });

export const TakenBatesRange = z
  .object({
    id: identifierField("batesRange"),
    logId: identifierField("batesLog"),
    prefix: z.string(),
    digits: z.number().int(),
    firstNumber: z.number().int(),
    lastNumber: z.number().int(),
  })
  .meta({ id: "TakenBatesRange" });

export const RecordBatesStampedFileRequest = z
  .object({ fileId: identifierField("file") })
  .meta({ id: "RecordBatesStampedFileRequest" });

export const BatesLogSummary = z
  .object({
    id: identifierField("batesLog"),
    name: z.string(),
    prefix: z.string(),
    digits: z.number().int(),
    nextNumber: z.number().int(),
    rangeCount: z.number().int(),
    pagesStamped: z.number().int(),
    lastStampedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: "BatesLogSummary" });

export const BatesLogList = capped(BatesLogSummary).meta({ id: "BatesLogList" });

export const BatesRange = z
  .object({
    id: identifierField("batesRange"),
    logId: identifierField("batesLog").nullable(),
    logName: z.string().nullable(),
    prefix: z.string(),
    digits: z.number().int(),
    firstNumber: z.number().int(),
    lastNumber: z.number().int(),
    pageCount: z.number().int(),
    purpose: z.enum(BATES_PURPOSES),
    sourceFileId: identifierField("file").nullable(),
    sourceFileName: z.string().nullable(),
    exhibitSetId: identifierField("exhibitSet").nullable(),
    stampedFileId: identifierField("file").nullable(),
    stampedFileName: z.string().nullable(),
    stampedFileSavedAt: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: "BatesRange" });

export const BatesRangeList = paginated(BatesRange).meta({ id: "BatesRangeList" });
