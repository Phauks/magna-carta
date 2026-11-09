import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  readMemberProfessionalProfile,
  upsertMemberProfessionalProfileStatement,
} from "@magna-carta/matters/member-professional-profile";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// A member's professional profile — title, admissions, direct dial, professional email, signature
// block — the identity a letter or a pleading states about the firm's own people. Two write doors,
// same record: a member maintains their OWN profile (no special permission; the actor is the
// subject), and an administrator maintains anyone's under firm:manageMembers. A member's bar number
// is deliberately NOT here: it is a sensitive identifier on the member's mapped Directory person,
// behind the protected-field chokepoint.

const ProfileFields = z
  .object({
    title: z.string().max(200).nullable(),
    admissions: z.string().max(2000).nullable().openapi({
      description: "Bar admissions as running prose the firm writes — never parsed, never guessed.",
    }),
    directDial: z.string().max(100).nullable(),
    professionalEmail: z.string().max(320).nullable(),
    signatureBlock: z
      .string()
      .max(4000)
      .nullable()
      .openapi({
        description:
          "The multi-line block a pleading signs off with, stored with its line breaks. It becomes a " +
          "merge field once the assembly engine emits real line breaks; until then it is recorded " +
          "here so nothing has to be retyped when that lands.",
      }),
  })
  .openapi("MemberProfessionalProfileFields");

// The record shape stays unnamed; naming it once and reusing it nullable in the read response
// would register one component name under two emitted shapes, which conformance refuses.
const ProfileRecord = z.object({ memberUserId: z.string() }).extend(ProfileFields.shape);

const ProfileResponse = ProfileRecord.openapi("MemberProfessionalProfileResponse");

const ProfileReadResponse = z
  .object({ profile: ProfileRecord.nullable() })
  .openapi("MemberProfessionalProfileReadResponse");

const memberParam = z.object({ userId: identifierPathParam("user", "userId") });

const readProfileMeta: RouteMeta = {
  operationId: "members.professionalProfile",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

// The member's OWN self-maintenance door is deliberately not here yet. The chokepoint's fitness
// rule refuses an authenticated mutation with permission: null (privilege escalation by omission),
// and the platform has no self-scoped mutation concept anywhere — the per-member analytics opt-out
// sits in the same gap. When the Members area designs self-service writes (a baseline capability or
// a chokepoint self-scope), PUT /api/v1/me/professional-profile lands on this same record with this
// same schema; until then a member's profile is written through the administrative door below.
const setMemberProfileMeta: RouteMeta = {
  operationId: "members.setProfessionalProfile",
  surface: "app",
  authenticated: true,
  permission: "firm:manageMembers",
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const authErrors = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
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
    description: "The firm is unreachable, the member is deactivated, or the member is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readProfileRoute = defineOpenAPIRoute(readProfileMeta, {
  method: "get",
  path: "/api/v1/members/{userId}/professional-profile",
  description:
    "Returns a member's professional profile, or null where none has been written yet. Open to any " +
    "authenticated member: it is the identity the firm's own documents state.",
  request: { params: memberParam },
  responses: {
    200: {
      description: "The member's professional profile, when one exists",
      content: { "application/json": { schema: ProfileReadResponse } },
    },
    401: authErrors[401],
    404: authErrors[404],
    429: authErrors[429],
  },
});

const setMemberProfileRoute = defineOpenAPIRoute(setMemberProfileMeta, {
  method: "put",
  path: "/api/v1/members/{userId}/professional-profile",
  description:
    "Writes any member's professional profile — the administrative door, under firm:manageMembers.",
  request: {
    headers: idempotencyKeyHeader,
    params: memberParam,
    body: { content: { "application/json": { schema: ProfileFields } }, required: true },
  },
  responses: {
    200: {
      description: "The written profile",
      content: { "application/json": { schema: ProfileResponse } },
    },
    400: authErrors[400],
    401: authErrors[401],
    403: authErrors[403],
    404: authErrors[404],
    409: authErrors[409],
    422: authErrors[422],
    429: authErrors[429],
  },
});

async function readProfile(
  database: SqlDatabase,
  memberUserId: UserId,
): Promise<z.infer<typeof ProfileResponse> | null> {
  const record = await readMemberProfessionalProfile(database, memberUserId);
  return record === undefined
    ? null
    : {
        memberUserId: record.memberUserId,
        title: record.title,
        admissions: record.admissions,
        directDial: record.directDial,
        professionalEmail: record.professionalEmail,
        signatureBlock: record.signatureBlock,
      };
}

async function memberExists(database: SqlDatabase, memberUserId: UserId): Promise<boolean> {
  const { results } = await database
    .prepare("SELECT 1 AS one FROM member WHERE user_id = ?1")
    .bind(memberUserId)
    .all<{ one: number }>();
  return results.length > 0;
}

type MemberProfilesApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerMemberProfilesRoutes(app: MemberProfilesApp, chokepoint: Chokepoint): void {
  // GET /api/v1/members/{userId}/professional-profile
  app.openapi(
    { ...readProfileRoute, middleware: chokepointMiddleware(chokepoint, readProfileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { userId } = c.req.valid("param");
      const profile = await readProfile(firm.firmDatabase, userId);
      return c.json({ profile } as z.infer<typeof ProfileReadResponse>, 200);
    },
  );

  // The shared commit both write doors call once they know the subject. The stored idempotency body
  // IS the wire body, so a replay answers byte-identically.
  interface ProfileWriteOutcome {
    readonly kind: "written" | "replayed" | "member-unknown" | "conflict";
    readonly body?: z.infer<typeof ProfileResponse>;
    readonly conflict?: Awaited<ReturnType<typeof runIdempotentEffect>>;
  }
  const commitProfile = async (
    firmDatabase: Parameters<typeof readProfile>[0] &
      Parameters<typeof runIdempotentEffect>[0]["database"],
    actorUserId: UserId,
    subject: UserId,
    fields: z.infer<typeof ProfileFields>,
    idempotency: { key: string; fingerprint: string },
  ): Promise<ProfileWriteOutcome> => {
    if (!(await memberExists(firmDatabase, subject))) {
      return { kind: "member-unknown" };
    }
    const result = await runIdempotentEffect({
      database: firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      effect: () => {
        const now = new Date().toISOString();
        return Promise.resolve({
          write: {
            statements: [
              upsertMemberProfessionalProfileStatement(firmDatabase, subject, fields, now),
              domainAuditStatement(firmDatabase, {
                event: "member.professional_profile.updated",
                subjectId: subject,
                actorUserId,
                clock: { now: () => now },
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 200,
          responseBody: canonicalJsonStringify({ memberUserId: subject, ...fields }),
        });
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return { kind: "conflict", conflict: result };
    }
    return {
      kind: result.kind === "replayed" ? "replayed" : "written",
      body: JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ProfileResponse>,
    };
  };

  const memberUnknown = (c: Parameters<typeof problemJson>[0]) =>
    problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such member in this firm.",
    });

  // PUT /api/v1/members/{userId}/professional-profile — the administrative door.
  app.openapi(
    {
      ...setMemberProfileRoute,
      middleware: chokepointMiddleware(chokepoint, setMemberProfileRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { userId } = c.req.valid("param");
      const fields = c.req.valid("json");
      const outcome = await commitProfile(
        firm.firmDatabase,
        actorUserId,
        userId,
        fields,
        idempotency,
      );
      if (outcome.kind === "member-unknown") return memberUnknown(c);
      if (outcome.kind === "conflict") {
        return problemResponseForIdempotencyConflict(
          c,
          outcome.conflict as { kind: "in-progress" | "fingerprint-mismatch" },
        );
      }
      if (outcome.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(outcome.body as z.infer<typeof ProfileResponse>, 200);
    },
  );
}
