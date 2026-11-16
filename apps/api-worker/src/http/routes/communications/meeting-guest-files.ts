import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { getCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import type {
  FileId,
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { requireGuestInTheRoom } from "@magna-carta/meetings/chat-service";
import { GuestMeetingFileAddress } from "@magna-carta/meetings/chat-contract";
import { isFileSharedInMeeting } from "@magna-carta/meetings/chat-statements";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveExportObject } from "../../../exports/export-object.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { presignerForEnv } from "../../../files/presigner-wiring.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointGuestGrant,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  guestCredentialHeader,
  guestErrorResponse,
  guestErrors,
  type GuestProblem,
} from "./meetings-guest.ts";

// A FILE SHARED IN A MEETING'S CHAT, OPENED BY A GUEST. The owner's ruling: a guest may open it
// while they are in the meeting. So this is the guest lane, and the reach is exactly that sentence:
// the guest's stay must be IN THE ROOM (open and admitted, the meeting not ended), and the file must
// be one a line of this meeting points at that has not been taken back, still live on the meeting's
// own matter. A file handle the guest names alone reaches nothing; every miss is the same 404.
//
// Only a CLEAN current version is handed over. A member may be let through to a flagged version by
// the firm's flagged-file treatment and an acknowledgement; a guest is somebody outside the firm and
// is not asked to accept that risk, so a flagged file is answered as not there.
//
// The address is answered as DATA, not a redirect: the guest's credential is a header, which the
// browser's own navigation to a link cannot send. The download is recorded on the firm's audit trail
// with no member behind it, naming the meeting and the guest's invitation and stay.

const DOWNLOAD_TTL_SECONDS = 300;

// The file is named in the QUERY, never the path: a guest route's path carries no identifier, so the
// address says which surface it is and the grant says which meeting.
const fileQuery = z.object({
  fileId: z
    .string()
    .regex(identifierPattern("file"))
    .openapi({ description: "The shared file, as the chat line names it." }),
});

const guestFileRoute = defineOpenAPIRoute(
  {
    operationId: "guest.openSharedFile",
    surface: "app",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
    guestLane: "grant",
  },
  {
    method: "get",
    path: "/api/v1/guest/meeting/files",
    description:
      "A short-lived address for a file shared in the meeting's chat, for a guest who is in the " +
      "room. Answered only for a file a line of this meeting points at that has not been taken back, " +
      "still on the meeting's matter, whose current version is clean; anything else is 404.",
    request: { headers: guestCredentialHeader, query: fileQuery },
    responses: {
      200: {
        description: "Where to fetch the file, for the next few minutes",
        content: { "application/json": { schema: GuestMeetingFileAddress } },
      },
      ...guestErrors,
    },
  },
);

function notShared(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "No such file is shared in this meeting.",
  });
}

export function registerMeetingGuestFileRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/guest/meeting/files?fileId=
  app.openapi(
    { ...guestFileRoute, middleware: chokepointMiddleware(chokepoint, guestFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointGuestGrant(c);
      const meetingId = grant.meetingId as MeetingId;
      const fileId = c.req.valid("query").fileId as FileId;
      let refused: GuestProblem | null = null;
      try {
        await requireGuestInTheRoom(firm.firmDatabase, {
          meetingId,
          invitationId: grant.invitationId as MeetingGuestInvitationId,
          stayId: (grant.stayId ?? "") as MeetingGuestStayId,
        });
      } catch (caught) {
        if (!(caught instanceof MeetingValidationError)) throw caught;
        refused = guestErrorResponse(c, caught);
      }
      if (refused !== null) return refused;
      if (!(await isFileSharedInMeeting(firm.firmDatabase, meetingId, fileId))) return notShared(c);
      const version = await getCurrentCleanVersion(firm.firmDatabase, fileId);
      if (version === undefined || version.scanVerdict === "flagged") return notShared(c);

      const now = new Date().toISOString();
      const bucket = resolveFirmBucket(c.env, firm.bucketName);
      // The copy that leaves is the export object, as a member's download is: a version with tracked
      // changes goes out with them accepted.
      const exportObject = await resolveExportObject(
        firm.firmDatabase,
        bucket.bucket,
        version,
        () => now,
      );
      const url = await presignerForEnv(c.env).presignGet(
        bucket.bucketName,
        exportObject.r2Key,
        DOWNLOAD_TTL_SECONDS,
      );
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "file.downloaded_by_meeting_guest",
              actorUserId: null,
              subjectId: version.id,
              metadata: {
                fileId,
                versionId: version.id,
                meetingId,
                invitationId: grant.invitationId,
                stayId: grant.stayId,
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.json({ url, name: version.name }, 200);
    },
  );
}
