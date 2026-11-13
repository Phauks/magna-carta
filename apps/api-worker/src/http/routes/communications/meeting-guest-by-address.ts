import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { MeetingId } from "@magna-carta/identifiers/types";
import { addGuestByAddress } from "@magna-carta/meetings/guest-by-address";
import { InviteGuestByAddressRequest } from "@magna-carta/meetings/guest-by-address-contract";
import { inviteGuest } from "@magna-carta/meetings/guest-service";
import { MeetingValidationError } from "@magna-carta/meetings/validation";
import type { Bindings } from "../../../bindings.ts";
import type { SendEmail } from "../../../email-port.ts";
import { eventEndInstant } from "../../../meetings/guest-invitation-mail.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  commitHostGuestEffect,
  guestErrorResponse,
  hostErrors,
  hostingOptions,
  MeetingGuestInvitation,
  replaceAndMail,
} from "./meetings-guest.ts";

// INVITING A GUEST BY NAME AND ADDRESS, for somebody the host has not found in the Directory.
//
// Two commits, in this order. The first matches the address to a Directory entity, or makes a person
// marked needs review, and puts them on the meeting's event (`addGuestByAddress`). The second is the
// ordinary invitation, through the same gate, mail and answer as `POST .../guests` — because the
// invitation's own reads (on the event, an address the firm may use) must see the first commit. The
// first needs no idempotency record of its own: a retry finds the person by the address it wrote and
// finds them on the event, so it writes nothing new.

// A host act on `meetings:host`, with the grant on the meeting checked in the service, as every other
// guest act a host takes.
const INVITE_BY_ADDRESS_META: RouteMeta = {
  operationId: "meetings.inviteGuestByAddress",
  surface: "app",
  authenticated: true,
  permission: "meetings:host",
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const meetingIdParam = z.object({ meetingId: identifierPathParam("meeting", "meetingId") });

const inviteByAddressRoute = defineOpenAPIRoute(INVITE_BY_ADDRESS_META, {
  method: "post",
  path: "/api/v1/meetings/{meetingId}/guests/by-address",
  description:
    "Invites somebody by the name and e-mail address the host typed. The address is matched to the " +
    "Directory entity that holds it; where none does, a person is created there marked as needing " +
    "review, with that address. The entity is put on this meeting's event and sent a link exactly " +
    "as `meetings.inviteGuest` sends one, and the answer is the same invitation.",
  request: {
    params: meetingIdParam,
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: InviteGuestByAddressRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The person already had an invitation, which was sent again with a fresh link",
      content: { "application/json": { schema: MeetingGuestInvitation } },
    },
    201: {
      description: "The invitation was created and sent",
      content: { "application/json": { schema: MeetingGuestInvitation } },
    },
    ...hostErrors,
  },
});

export function registerMeetingGuestByAddressRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  sendEmail: (env: Bindings) => SendEmail,
): void {
  // POST /api/v1/meetings/{meetingId}/guests/by-address
  app.openapi(
    {
      ...inviteByAddressRoute,
      middleware: chokepointMiddleware(chokepoint, inviteByAddressRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const idempotency = requireChokepointIdempotency(c);
      const { meetingId } = c.req.valid("param");
      const { name, emailAddress } = c.req.valid("json");

      let entityId: string;
      try {
        const added = await addGuestByAddress(
          firm.firmDatabase,
          meetingId as MeetingId,
          { name, emailAddress },
          hostingOptions(c),
        );
        await commitEffectBatch(firm.firmDatabase, added.effect, {
          now: () => new Date().toISOString(),
        });
        entityId = added.entityId;
      } catch (caught) {
        if (caught instanceof MeetingValidationError) return guestErrorResponse(c, caught);
        throw caught;
      }

      const outcome = await commitHostGuestEffect(c, firm.firmDatabase, idempotency, async () => {
        const minted = await inviteGuest(
          firm.firmDatabase,
          meetingId as MeetingId,
          { entityId, eventEndsAt: eventEndInstant },
          hostingOptions(c),
        );
        return {
          value: minted.invitation,
          responseCode: minted.reissued ? 200 : 201,
          effect: minted.effect,
          afterCommit: () => replaceAndMail(c, sendEmail, meetingId, minted),
        };
      });
      if (!outcome.ok) return outcome.problem;
      return outcome.responseCode === 201 ? c.json(outcome.value, 201) : c.json(outcome.value, 200);
    },
  );
}
