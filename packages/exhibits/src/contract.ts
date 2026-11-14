import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { identifierField } from "@magna-carta/identifiers/field";
import { EXHIBIT_OVERFLOW_FORMS, EXHIBIT_SEQUENCES } from "./scheme.ts";
import {
  EXHIBIT_DISPOSITIONS,
  EXHIBIT_MEMBER_STATUSES,
  EXHIBIT_SET_STATES,
  EXHIBIT_SOURCE_KINDS,
  MAX_BASIS_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_MEMBERS_PER_SET,
  MAX_NOUN_LENGTH,
  MAX_PREFIX_LENGTH,
  MAX_REFERENCE_NAME_LENGTH,
  MAX_SET_NAME_LENGTH,
  MAX_START_AT,
  MAX_TITLE_LENGTH,
} from "./types.ts";

// The exhibits contract: what the API accepts in a request body and returns in a response, as
// plain zod named with `.meta({ id })`. Path and query parameters stay with the routes in
// apps/api-worker. The service re-validates every field, so these shapes are the wire's promise
// rather than the only guard.

const CIVIL_DATE = CIVIL_DATE_PATTERN;

const schemeShape = {
  noun: z.string().max(MAX_NOUN_LENGTH),
  prefix: z.string().max(MAX_PREFIX_LENGTH),
  sequence: z.enum(EXHIBIT_SEQUENCES),
  startAt: z.number().int().min(1).max(MAX_START_AT),
  overflowForm: z.enum(EXHIBIT_OVERFLOW_FORMS),
};

export const ExhibitScheme = z.object(schemeShape).meta({ id: "ExhibitScheme" });
export const ExhibitSchemeInput = z
  .object({
    noun: schemeShape.noun.optional(),
    prefix: schemeShape.prefix.optional(),
    sequence: schemeShape.sequence.optional(),
    startAt: schemeShape.startAt.optional(),
    overflowForm: schemeShape.overflowForm.optional(),
  })
  .meta({ id: "ExhibitSchemeInput" });

export const ExhibitSchemePresets = z
  .object({
    defaultScheme: ExhibitScheme,
    presets: z.array(z.object({ key: z.string(), name: z.string(), scheme: ExhibitScheme })),
  })
  .meta({ id: "ExhibitSchemePresets" });

export const CreateExhibitRequest = z
  .object({
    fileId: identifierField("file"),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
    sourceKind: z.enum(EXHIBIT_SOURCE_KINDS).optional(),
    referenceName: z.string().min(1).max(MAX_REFERENCE_NAME_LENGTH).optional(),
    pinnedFileVersionId: identifierField("fileVersion").nullable().optional(),
    pageCount: z.number().int().min(0).nullable().optional(),
  })
  .meta({ id: "CreateExhibitRequest" });

export const CreatedExhibit = z
  .object({ id: identifierField("matterExhibit"), referenceName: z.string() })
  .meta({ id: "CreatedExhibit" });

export const EditExhibitRequest = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
    // A version id pins the exhibit to it; null floats it on the file's current clean version.
    pinnedFileVersionId: identifierField("fileVersion").nullable().optional(),
    pageCount: z.number().int().min(0).nullable().optional(),
    archived: z.literal(true).optional(),
  })
  .meta({ id: "EditExhibitRequest" });

export const ExhibitAppearance = z
  .object({
    setId: identifierField("exhibitSet"),
    setName: z.string(),
    state: z.enum(EXHIBIT_SET_STATES),
    label: z.string(),
    status: z.enum(EXHIBIT_MEMBER_STATUSES),
  })
  .meta({ id: "ExhibitAppearance" });

export const MatterExhibit = z
  .object({
    id: identifierField("matterExhibit"),
    referenceName: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    sourceKind: z.enum(EXHIBIT_SOURCE_KINDS),
    fileId: identifierField("file"),
    fileName: z.string().nullable(),
    pinnedFileVersionId: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    batesBegin: z.string().nullable(),
    batesEnd: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
    appearances: z.array(ExhibitAppearance),
  })
  .meta({ id: "MatterExhibit" });

export const MatterExhibitList = z
  .object({ data: z.array(MatterExhibit) })
  .meta({ id: "MatterExhibitList" });

export const CreateExhibitSetRequest = z
  .object({
    name: z.string().min(1).max(MAX_SET_NAME_LENGTH),
    scheme: ExhibitSchemeInput.optional(),
  })
  .meta({ id: "CreateExhibitSetRequest" });

export const EditExhibitSetRequest = z
  .object({
    name: z.string().min(1).max(MAX_SET_NAME_LENGTH).optional(),
    scheme: ExhibitSchemeInput.optional(),
    archived: z.literal(true).optional(),
  })
  .meta({ id: "EditExhibitSetRequest" });

const setSummaryShape = {
  id: identifierField("exhibitSet"),
  matterId: identifierField("matter"),
  name: z.string(),
  scheme: ExhibitScheme,
  state: z.enum(EXHIBIT_SET_STATES),
  memberCount: z.number().int(),
  continuesFromSetId: z.string().nullable(),
  supersedesSetId: z.string().nullable(),
  supersededBySetId: z.string().nullable(),
  disposition: z.enum(EXHIBIT_DISPOSITIONS).nullable(),
  issuedOn: z.string().nullable(),
  issuedAt: z.string().nullable(),
  issuedBy: z.string().nullable(),
  filedCopyFileId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const ExhibitSetSummary = z.object(setSummaryShape).meta({ id: "ExhibitSetSummary" });

export const ExhibitSetList = z
  .object({ data: z.array(ExhibitSetSummary) })
  .meta({ id: "ExhibitSetList" });

export const ExhibitSetMember = z
  .object({
    id: identifierField("exhibitSetMember"),
    exhibitId: identifierField("matterExhibit"),
    position: z.number().int(),
    label: z.string(),
    caption: z.string(),
    referenceName: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    sourceKind: z.enum(EXHIBIT_SOURCE_KINDS),
    fileId: identifierField("file"),
    fileName: z.string().nullable(),
    pinnedFileVersionId: z.string().nullable(),
    fileVersionId: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    batesBegin: z.string().nullable(),
    batesEnd: z.string().nullable(),
    status: z.enum(EXHIBIT_MEMBER_STATUSES),
    withdrawnAt: z.string().nullable(),
    withdrawalBasis: z.string().nullable(),
    titleAsIssued: z.string().nullable(),
    fileVersionIdAsIssued: z.string().nullable(),
    correctedAt: z.string().nullable(),
    correctionBasis: z.string().nullable(),
  })
  .meta({ id: "ExhibitSetMember" });

export const ExhibitSetDetail = z
  .object({ ...setSummaryShape, members: z.array(ExhibitSetMember) })
  .meta({ id: "ExhibitSetDetail" });

export const AddExhibitSetMembersRequest = z
  .object({ exhibitIds: z.array(identifierField("matterExhibit")).min(1).max(MAX_MEMBERS_PER_SET) })
  .meta({ id: "AddExhibitSetMembersRequest" });

export const AddedExhibitSetMembers = z
  .object({ memberIds: z.array(identifierField("exhibitSetMember")) })
  .meta({ id: "AddedExhibitSetMembers" });

export const ReorderExhibitSetRequest = z
  .object({ memberIds: z.array(identifierField("exhibitSetMember")).max(MAX_MEMBERS_PER_SET) })
  .meta({ id: "ReorderExhibitSetRequest" });

export const ExhibitLabelMoves = z
  .object({
    moves: z.array(
      z.object({ memberId: identifierField("exhibitSetMember"), from: z.string(), to: z.string() }),
    ),
  })
  .meta({ id: "ExhibitLabelMoves" });

export const IssueExhibitSetRequest = z
  .object({
    disposition: z.enum(EXHIBIT_DISPOSITIONS),
    issuedOn: z.string().regex(CIVIL_DATE),
    filedCopyFileId: identifierField("file").nullable().optional(),
  })
  .meta({ id: "IssueExhibitSetRequest" });

export const IssuedExhibitSet = z
  .object({
    labels: z.array(z.object({ memberId: identifierField("exhibitSetMember"), label: z.string() })),
  })
  .meta({ id: "IssuedExhibitSet" });

export const WithdrawExhibitRequest = z
  .object({ basis: z.string().min(1).max(MAX_BASIS_LENGTH) })
  .meta({ id: "WithdrawExhibitRequest" });

export const CorrectExhibitRequest = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
    fileVersionId: identifierField("fileVersion").optional(),
    basis: z.string().min(1).max(MAX_BASIS_LENGTH),
  })
  .meta({ id: "CorrectExhibitRequest" });

export const SupersedeExhibitSetRequest = z
  .object({
    name: z.string().min(1).max(MAX_SET_NAME_LENGTH).optional(),
    continueNumbering: z.boolean().optional(),
  })
  .meta({ id: "SupersedeExhibitSetRequest" });

export const ContinueExhibitSetRequest = z
  .object({ name: z.string().min(1).max(MAX_SET_NAME_LENGTH) })
  .meta({ id: "ContinueExhibitSetRequest" });

export const CreatedExhibitSet = z
  .object({ id: identifierField("exhibitSet") })
  .meta({ id: "CreatedExhibitSet" });
