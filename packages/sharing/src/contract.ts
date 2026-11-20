import { z } from "zod";
import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { identifierField } from "@magna-carta/identifiers/field";
import { MAXIMUM_SHARES_PER_WRITE } from "./share-service.ts";
import { SHARE_ROLES, SHARE_SIGN_INS } from "./types.ts";

// The sharing contract: request bodies and responses, as plain zod named with `.meta({ id })`. Path
// parameters stay with the routes in apps/api-worker. The service re-validates every field.

/** How many people one share request may name. */
export const MAXIMUM_PEOPLE_PER_WRITE = 50;

export const ShareTargetBody = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("matter") }),
  z.object({ scope: z.literal("folder"), folderId: identifierField("folder") }),
  z.object({
    scope: z.literal("file"),
    fileId: identifierField("file"),
    // Hold this version still, so the person keeps seeing the copy that was sent.
    fileVersionId: identifierField("fileVersion").nullable().optional(),
  }),
]);

export const ShareFilesRequest = z
  .object({
    items: z.array(ShareTargetBody).min(1).max(MAXIMUM_SHARES_PER_WRITE),
    people: z
      .array(z.object({ entityId: identifierField("directoryPerson"), role: z.enum(SHARE_ROLES) }))
      .min(1)
      .max(MAXIMUM_PEOPLE_PER_WRITE),
    allowDownload: z.boolean().optional(),
    signIn: z.enum(SHARE_SIGN_INS).optional(),
    endsOn: z.string().regex(CIVIL_DATE_PATTERN).nullable().optional(),
  })
  .meta({ id: "ShareFilesRequest" });

export const ChangeShareRequest = z
  .object({
    role: z.enum(SHARE_ROLES).optional(),
    allowDownload: z.boolean().optional(),
    signIn: z.enum(SHARE_SIGN_INS).optional(),
    endsOn: z.string().regex(CIVIL_DATE_PATTERN).nullable().optional(),
  })
  .meta({ id: "ChangeShareRequest" });

export const ShareSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    scope: z.enum(["matter", "folder", "file"]),
    folderId: z.string().nullable(),
    fileId: z.string().nullable(),
    fileVersionId: z.string().nullable(),
    recipientEntityId: z.string(),
    recipientName: z.string().nullable(),
    role: z.enum(SHARE_ROLES),
    allowDownload: z.boolean(),
    signIn: z.enum(SHARE_SIGN_INS),
    endsOn: z.string().nullable(),
    sharedByUserId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Present when the share is still recorded but no longer opens: "ended" past its end date,
    // "needsNewSharer" when the member who made it can no longer share. Changing it takes it over.
    dormant: z.enum(["ended", "needsNewSharer"]).nullable(),
  })
  .meta({ id: "ShareSummary" });

export const ShareListResponse = z
  .object({ data: z.array(ShareSummary) })
  .meta({ id: "ShareListResponse" });

export const SharedFilesResponse = z
  .object({ shareIds: z.array(z.string()) })
  .meta({ id: "SharedFilesResponse" });

export const ShareAcknowledged = z
  .object({ ok: z.literal(true) })
  .meta({ id: "ShareAcknowledged" });
