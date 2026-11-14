import { z } from "zod";
import { SOURCE_FILE_FORMATS } from "./source-file.ts";
import { TRANSFER_PASS_RECORD_KINDS } from "./transfer-pass-statements.ts";

// What the record transfer's routes take and answer, as plain zod. Each component is named with
// zod's own metadata (`.meta({ id })`), which the contract emitter reads as the component's name.
//
// The mapping rules are the same shapes the mapping modules read (directory-mapping.ts and
// matter-mapping.ts), restated here as schemas because rules arrive from a screen and are stored as
// JSON: they are checked on the way in, and again by the job that reads them back.

// A column is named exactly as the file's header row names it, so it is not trimmed.
const column = z.string().min(1).max(200);
const slug = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,62}$/,
    "lower-case letters, digits and hyphens, starting with a letter",
  );

export const SourceDateOrderSchema = z.enum(["year-month-day", "day-month-year", "month-day-year"]);

const contactColumns = {
  emails: z.array(column).max(10).optional(),
  phones: z
    .array(z.strictObject({ column, fax: z.boolean().optional() }))
    .max(10)
    .optional(),
  address: z
    .strictObject({
      street: column.optional(),
      streetTwo: column.optional(),
      dependentLocality: column.optional(),
      city: column.optional(),
      region: column.optional(),
      postal: column.optional(),
    })
    .optional(),
  addressCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
};

export const PersonMappingRulesSchema = z
  .strictObject({
    given: column,
    family: column,
    prefix: column.optional(),
    middle: column.optional(),
    suffix: column.optional(),
    dateOfBirth: column.optional(),
    dateOrder: SourceDateOrderSchema.optional(),
    ...contactColumns,
  })
  .refine((rules) => rules.dateOfBirth === undefined || rules.dateOrder !== undefined, {
    message: "a date of birth column needs the order its dates are written in",
    path: ["dateOrder"],
  })
  .meta({ id: "RecordTransferPersonRules" });

export const OrganizationMappingRulesSchema = z
  .strictObject({ legalName: column, ...contactColumns })
  .meta({ id: "RecordTransferOrganizationRules" });

const reference = { column, sourceKind: slug };
const identifier = z.string().min(1).max(100);

export const MatterMappingRulesSchema = z
  .strictObject({
    title: column,
    number: column,
    description: column.optional(),
    clientDisplayName: column.optional(),
    openedDate: column,
    closedDate: column.optional(),
    dateOrder: SourceDateOrderSchema,
    timeZone: z.string().min(1).max(100),
    client: z.strictObject(reference).optional(),
    parties: z
      .array(z.strictObject({ ...reference, role: z.string().trim().min(1).max(100) }))
      .max(20)
      .optional(),
    matterType: z
      .strictObject({ column, types: z.record(z.string().max(200), identifier) })
      .optional(),
    responsibleMember: z.strictObject({
      column: column.optional(),
      members: z.record(z.string().max(200), identifier),
      otherwise: identifier.optional(),
    }),
  })
  .meta({ id: "RecordTransferMatterRules" });

export const StartTransferRunRequest = z
  .strictObject({
    // The system the firm is leaving, as a slug: `leap`, never `LEAP`.
    sourceSystem: slug,
    // What a person calls this run: "Rehearsal 3", "Cutover".
    label: z.string().trim().min(1).max(120),
  })
  .meta({ id: "StartRecordTransferRunRequest" });

export const TransferRun = z
  .object({
    id: z.string(),
    sourceSystem: z.string(),
    label: z.string(),
    startedBy: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    abandonedAt: z.string().nullable(),
  })
  .meta({ id: "RecordTransferRun" });

export const TransferSourceFile = z
  .object({
    id: z.string(),
    sourceKind: z.string(),
    format: z.enum(SOURCE_FILE_FORMATS),
    fileName: z.string(),
    byteLength: z.number().int().nonnegative(),
    contentSha256: z.string(),
    keyColumn: z.string().nullable(),
    // Data rows, known once a pass has read the file to its end.
    rowCount: z.number().int().nonnegative().nullable(),
    registeredAt: z.string(),
    removedAt: z.string().nullable(),
  })
  .meta({ id: "RecordTransferSourceFile" });

// `requested` has not been picked up; `running` has; `stalled` started long enough ago that the job
// holding it must have died, and asking for the pass again is the way on. A second pass repeats
// nothing the first one wrote.
export const TransferPassState = z.enum(["requested", "running", "stalled", "finished", "failed"]);

export const TransferPass = z
  .object({
    id: z.string(),
    fileId: z.string(),
    recordKind: z.enum(TRANSFER_PASS_RECORD_KINDS),
    sourceKind: z.string(),
    state: TransferPassState,
    requestedBy: z.string(),
    requestedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    failedAt: z.string().nullable(),
    // Null until the pass finishes. rowsRead = created + alreadyLinked + rejected + waiting.
    counts: z
      .object({
        rowsRead: z.number().int().nonnegative(),
        created: z.number().int().nonnegative(),
        alreadyLinked: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        waiting: z.number().int().nonnegative(),
        findings: z.number().int().nonnegative(),
        columnsMissing: z.number().int().nonnegative(),
      })
      .nullable(),
  })
  .meta({ id: "RecordTransferPass" });

export const TransferRunListResponse = z
  .object({ runs: z.array(TransferRun) })
  .meta({ id: "RecordTransferRunListResponse" });

export const TransferRunResponse = z
  .object({ run: TransferRun, files: z.array(TransferSourceFile), passes: z.array(TransferPass) })
  .meta({ id: "RecordTransferRunResponse" });

export const TransferSourceFileResponse = z
  .object({ file: TransferSourceFile })
  .meta({ id: "RecordTransferSourceFileResponse" });

// The header row and the first few data rows, so a person can say what each column holds. These
// are values from the file, shown to the member who uploaded it and stored nowhere.
export const TransferSourceFilePreviewResponse = z
  .object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  })
  .meta({ id: "RecordTransferSourceFilePreviewResponse" });

const passTarget = {
  fileId: z.string().min(1).max(100),
  // The kind the file's rows are linked under, which is what another file's reference names.
  sourceKind: slug,
  // The column holding the source system's key for a row.
  keyColumn: column,
  // The character between two values. A comma when left out.
  delimiter: z.enum([",", "\t", ";", "|"]).optional(),
};

export const RequestTransferPassRequest = z
  .discriminatedUnion("recordKind", [
    z.strictObject({
      recordKind: z.literal("person"),
      ...passTarget,
      rules: PersonMappingRulesSchema,
    }),
    z.strictObject({
      recordKind: z.literal("organization"),
      ...passTarget,
      rules: OrganizationMappingRulesSchema,
    }),
    z.strictObject({
      recordKind: z.literal("matter"),
      ...passTarget,
      rules: MatterMappingRulesSchema,
    }),
  ])
  .meta({ id: "RequestRecordTransferPassRequest" });

export const TransferPassResponse = z
  .object({ pass: TransferPass })
  .meta({ id: "RecordTransferPassResponse" });

const place = { rowNumber: z.number().int().positive(), lineNumber: z.number().int().positive() };

// The whole report of a finished pass. It holds positions, column names, fixed reasons, source keys
// and identifiers, and no other value from the file.
export const TransferPassReport = z
  .object({
    columnsMissing: z.array(z.string()),
    rowsRead: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    alreadyLinked: z.number().int().nonnegative(),
    rejected: z.array(z.object({ ...place, reason: z.string() })),
    waiting: z.array(
      z.object({
        ...place,
        missing: z.array(z.object({ sourceKind: z.string(), sourceId: z.string() })),
      }),
    ),
    findings: z.array(z.object({ ...place, column: z.string(), finding: z.string() })),
    sample: z.array(z.object({ ...place, localId: z.string() })),
  })
  .meta({ id: "RecordTransferPassReport" });

// Why a pass stopped without a report. `sourceFileNotHeld` means the file's bytes were released or
// never arrived; `fileNotReadable` means the file cannot be read as rows at all, and `fileFault`
// says how; `fault` is an error nobody expected, reported through the error pipeline.
export const TransferPassFailure = z
  .object({
    reason: z.enum(["sourceFileNotHeld", "fileNotReadable", "rulesNotReadable", "fault"]),
    fileFault: z
      .enum(["noHeader", "blankColumnName", "duplicateColumnName", "unterminatedQuote"])
      .nullable(),
    lineNumber: z.number().int().positive().nullable(),
  })
  .meta({ id: "RecordTransferPassFailure" });

// Exactly one of the two is present once a pass has ended; both are null before that.
export const TransferPassReportResponse = z
  .object({ report: TransferPassReport.nullable(), failure: TransferPassFailure.nullable() })
  .meta({ id: "RecordTransferPassReportResponse" });

export type StartTransferRunBody = z.infer<typeof StartTransferRunRequest>;
export type RequestTransferPassBody = z.infer<typeof RequestTransferPassRequest>;
export type TransferRunBody = z.infer<typeof TransferRun>;
export type TransferSourceFileBody = z.infer<typeof TransferSourceFile>;
export type TransferPassBody = z.infer<typeof TransferPass>;
export type TransferPassFailureBody = z.infer<typeof TransferPassFailure>;
export type TransferPassReportResponseBody = z.infer<typeof TransferPassReportResponse>;
export type TransferRunResponseBody = z.infer<typeof TransferRunResponse>;
