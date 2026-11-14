import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { readMeetingSummaryByJoinCode } from "@magna-carta/meetings/meeting-statements";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";

// A MEETING BY ITS NINE-DIGIT ADDRESS: /meeting/482-917-305 in the browser asks this for the meeting
// it names, then reads and joins it by id like any other. Through the same visibility gate as every
// meeting read, so a code for a meeting on a matter the caller may not see answers exactly as a code
// that names nothing does.

const joinCodeParam = z.object({
  joinCode: z
    .string()
    .regex(/^\d{9}$/)
    .openapi({ param: { name: "joinCode", in: "path" }, example: "482917305" }),
});

const MeetingByCodeResponse = z.object({ meetingId: z.string() }).openapi("MeetingByCodeResponse");

const byCodeRoute = defineOpenAPIRoute(
  {
    operationId: "meetings.getByCode",
    surface: "app",
    authenticated: true,
    permission: "meetings:join",
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/meetings/by-code/{joinCode}",
    description: "The meeting a nine-digit meeting address names, as its id.",
    request: { params: joinCodeParam },
    responses: {
      200: {
        description: "The meeting",
        content: { "application/json": { schema: MeetingByCodeResponse } },
      },
      401: {
        description: "No valid session",
        content: { "application/problem+json": { schema: Problem } },
      },
      403: {
        description: "The session member lacks the required permission",
        content: { "application/problem+json": { schema: Problem } },
      },
      404: {
        description: "No meeting this member can reach at that address",
        content: { "application/problem+json": { schema: Problem } },
      },
      429: {
        description: "Rate limited",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

export function registerMeetingByCodeRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/meetings/by-code/{joinCode}
  app.openapi(
    { ...byCodeRoute, middleware: chokepointMiddleware(chokepoint, byCodeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { joinCode } = c.req.valid("param");
      const summary = await readMeetingSummaryByJoinCode(
        firm.firmDatabase,
        joinCode,
        visibleMatterPredicate(),
      );
      if (summary === undefined) {
        return problemJson(c, {
          type: "meeting-not-found",
          title: "Not found",
          status: 404,
          detail: "No such meeting in this firm.",
        });
      }
      return c.json({ meetingId: summary.id }, 200);
    },
  );
}
