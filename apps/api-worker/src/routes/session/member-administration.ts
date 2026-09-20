import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  deleteRoleAssignmentStatement,
  insertRoleAssignmentStatement,
  readActiveMemberIdsWithPermission,
  rolesCarryPermission,
  ROLE_NAME_SEPARATOR,
  selectFirmRolesStatement,
  selectMemberRoleIdsStatement,
  selectMemberStatusStatement,
  setMemberStatusStatement,
  type FirmRoleRow,
} from "@magna-carta/data-access/member-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { UserId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import {
  idempotencyKeyHeader,
  identifierField,
  identifierPathParam,
} from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// THE FIRM ADMINISTERING ITS MEMBERS — what somebody holds, and whether they are still here. The
// invitation that creates a member lives beside the roster read in members.ts, because it writes to
// the control plane; everything after it is per-firm and lives here.
//
// TWO REFUSALS, both enforced here rather than left to the screen, because a screen is not the only
// caller and a firm that gets this wrong cannot fix it from inside the product.
//
// NOBODY ADMINISTERS THEMSELVES. Self-promotion is the whole reason the permission exists, and
// self-demotion is an accident rather than a use case: a member who genuinely means to give up
// their administration asks another administrator, which leaves the record this firm's own audit
// log is for. Refused as a 403, on the role change and on deactivation alike.
//
// A FIRM ALWAYS KEEPS SOMEBODY WHO CAN ADMINISTER IT — a backstop, and honestly a narrow one. The
// self-administration rule above already carries the ordinary case on its own: the actor holds
// firm:manageMembers (the chokepoint saw to that) and is never the subject, so an active
// administrator is left standing by construction. What this check actually catches is the race the
// first rule cannot — two administrators demoting each other at once, where each read sees the
// other still holding it and both writes land. Reading before the write narrows that window rather
// than closing it; closing it wants the count inside the same transaction as the write, which the
// batch shape here does not express. It is kept because it becomes load-bearing the moment either
// half changes: an owner-transfer flow that relaxes self-administration, or a principal reaching
// these routes without being a member of the firm.
//
// Both are computed against the state the write would LEAVE, not the state it found: the question
// is never "does this member hold it now" but "would anyone hold it after". A refusal is a 422
// naming the rule — never a silent no-op, which would read as success and leave the caller
// believing a change landed.

const MANAGE_PERMISSION = "firm:manageMembers" as const;
const READ_PERMISSION = "firm:readMembers" as const;

/** A role and what holding it means, as the surface that grants one reads it. */
const FirmRole = z
  .object({
    id: z.string(),
    name: z.string(),
    permissions: z.array(z.string()).openapi({
      description:
        "The permission keys this role carries, in registry form. Empty where the role carries " +
        "none, which is a real state rather than a missing answer.",
    }),
    memberCount: z.number().int().openapi({
      description: "How many ACTIVE members hold this role — who a change to it would reach.",
    }),
  })
  .openapi("FirmRole");

const FirmRoleListResponse = z.object({ data: z.array(FirmRole) }).openapi("FirmRoleListResponse");

const SetMemberRolesRequest = z
  .object({
    roleIds: z
      .array(identifierField("role"))
      .max(50)
      .openapi({
        description:
          "The roles this member is to hold, as a whole set rather than a change to it. The " +
          "server diffs against what they hold now, so a role in both lists is never momentarily " +
          "removed. An empty array leaves the member holding nothing.",
      }),
  })
  .openapi("SetMemberRolesRequest");

const MemberRolesResponse = z
  .object({
    userId: z.string(),
    roleIds: z.array(z.string()),
  })
  .openapi("MemberRolesResponse");

const MemberStatusResponse = z
  .object({
    userId: z.string(),
    status: z.enum(["active", "deactivated"]),
  })
  .openapi("MemberStatusResponse");

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description:
      "The session member lacks the required permission, or is the subject of their own request",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the session member is deactivated, or no such member in this firm",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "A named role does not exist, the change would leave the firm with nobody who can " +
      "administer its members, or the Idempotency-Key was reused with a different payload",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const memberParam = z.object({ userId: identifierPathParam("user", "userId") });

const listRolesMeta: RouteMeta = {
  operationId: "roles.list",
  surface: "app",
  authenticated: true,
  // Reading what a role means rides the roster read rather than a key of its own: the roster
  // already discloses which roles a member holds, so naming the capabilities behind those roles
  // discloses nothing further — and a member who can see that a colleague is an Attorney should be
  // able to see what the firm decided that means.
  permission: READ_PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const setRolesMeta: RouteMeta = {
  operationId: "members.setRoles",
  surface: "app",
  authenticated: true,
  permission: MANAGE_PERMISSION,
  resource: "firm",
  // Audited: what somebody may do in the firm, and who decided it. The metadata is handles and the
  // role sets on either side of the change — nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const deactivateMeta: RouteMeta = {
  operationId: "members.deactivate",
  surface: "app",
  authenticated: true,
  permission: MANAGE_PERMISSION,
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const reactivateMeta: RouteMeta = {
  operationId: "members.reactivate",
  surface: "app",
  authenticated: true,
  permission: MANAGE_PERMISSION,
  resource: "firm",
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const listRolesRoute = defineOpenAPIRoute(listRolesMeta, {
  method: "get",
  path: "/api/v1/roles",
  description:
    "Lists the firm's roles: what each one is called, the permissions it carries, and how many " +
    "active members hold it. The reference a person consults before granting one — a role name " +
    "alone says nothing about what it lets somebody do.",
  responses: {
    200: {
      description: "The firm's roles, ordered by name",
      content: { "application/json": { schema: FirmRoleListResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const setRolesRoute = defineOpenAPIRoute(setRolesMeta, {
  method: "put",
  path: "/api/v1/members/{userId}/roles",
  description:
    "Sets the roles a member holds, as a whole set. Refused when the actor is the subject, and " +
    "refused when the change would leave the firm with no active member who can administer its " +
    "members. Returns the roles held after the write.",
  request: {
    params: memberParam,
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: SetMemberRolesRequest } } },
  },
  responses: {
    200: {
      description: "The roles the member holds after the write",
      content: { "application/json": { schema: MemberRolesResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const deactivateRoute = defineOpenAPIRoute(deactivateMeta, {
  method: "post",
  path: "/api/v1/members/{userId}/deactivation",
  description:
    "Deactivates a member: their sessions stop resolving to any capability, and their rows stay. " +
    "A deactivated member is still the responsible attorney on the matters they carried and the " +
    "author of what they filed, so the roster keeps listing them. Refused when the actor is the " +
    "subject, and refused for the last member who can administer the firm.",
  request: {
    params: memberParam,
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: {
      description: "The member's status after the write",
      content: { "application/json": { schema: MemberStatusResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const reactivateRoute = defineOpenAPIRoute(reactivateMeta, {
  method: "post",
  path: "/api/v1/members/{userId}/reactivation",
  description:
    "Returns a deactivated member to active. They hold whatever roles they held when they left — " +
    "deactivation suspends a member's access rather than stripping what they were given, so a " +
    "return does not mean re-granting it by hand.",
  request: {
    params: memberParam,
    headers: idempotencyKeyHeader,
  },
  responses: {
    200: {
      description: "The member's status after the write",
      content: { "application/json": { schema: MemberStatusResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type AdministrationApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

/** A role's permission keys, unpacked from the one column the read packs them into. */
function unpackPermissions(packed: string | null): string[] {
  if (packed === null || packed === "") return [];
  return packed.split(ROLE_NAME_SEPARATOR).filter((permission) => permission !== "");
}

/** The member's status, or null where this firm has no such member. */
async function readMemberStatus(
  database: SqlDatabase,
  userId: UserId,
): Promise<"active" | "deactivated" | null> {
  const { results } = await selectMemberStatusStatement(database, userId).all<{ status: string }>();
  const row = results[0];
  if (row === undefined) return null;
  // Anything that is not the known deactivated literal reads as active — the schema's own default,
  // and the same fail-open the roster read takes: a row nobody deactivated is somebody still here.
  return row.status === "deactivated" ? "deactivated" : "active";
}

async function readMemberRoleIds(database: SqlDatabase, userId: UserId): Promise<string[]> {
  const { results } = await selectMemberRoleIdsStatement(database, userId).all<{
    roleId: string;
  }>();
  return results.map((row) => row.roleId);
}

/**
 * Would the firm still have somebody who can administer its members, once `subjectUserId` stops
 * counting? Every OTHER active holder answers yes on its own; the subject's own remaining claim is
 * the caller's to weigh, because only the caller knows what the write leaves them holding.
 */
async function anotherAdministratorRemains(
  database: SqlDatabase,
  subjectUserId: UserId,
  now: string,
): Promise<boolean> {
  const holders = await readActiveMemberIdsWithPermission(database, MANAGE_PERMISSION, now);
  return holders.some((userId) => userId !== subjectUserId);
}

function lastAdministratorProblem(c: Context, detail: string): ProblemResponse<422> {
  return problemJson(c, {
    type: "last-administrator",
    title: "The firm would have no administrator",
    status: 422,
    detail,
  });
}

export function registerMemberAdministrationRoutes(
  app: AdministrationApp,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/roles
  app.openapi(
    { ...listRolesRoute, middleware: chokepointMiddleware(chokepoint, listRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await selectFirmRolesStatement(firm.firmDatabase).all<FirmRoleRow>();
      return c.json(
        {
          data: results.map((row) => ({
            id: row.id,
            name: row.name,
            permissions: unpackPermissions(row.permissions),
            memberCount: row.memberCount,
          })),
        } satisfies z.infer<typeof FirmRoleListResponse>,
        200,
      );
    },
  );

  // PUT /api/v1/members/{userId}/roles
  app.openapi(
    { ...setRolesRoute, middleware: chokepointMiddleware(chokepoint, setRolesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const subjectUserId = c.req.valid("param").userId;
      const requested = c.req.valid("json").roleIds;

      if (subjectUserId === actorUserId) {
        return problemJson(c, {
          type: "self-administration",
          title: "A member cannot change their own roles",
          status: 403,
          detail:
            "Ask another member who can administer the firm. The change is then recorded against " +
            "the person who made it.",
        });
      }

      const status = await readMemberStatus(firm.firmDatabase, subjectUserId);
      if (status === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such member in this firm.",
        });
      }

      // The requested set as the firm's own roles: a handle naming no role of this firm is refused
      // rather than assigned, so a typo cannot leave a member holding a role that does not exist.
      const { results: roleRows } = await selectFirmRolesStatement(
        firm.firmDatabase,
      ).all<FirmRoleRow>();
      const knownRoleIds = new Set(roleRows.map((row) => row.id));
      // De-duplicated: the same role named twice is one assignment, and the diff below must not
      // then try to insert it twice.
      const target = [...new Set<string>(requested)];
      const unknown = target.filter((roleId) => !knownRoleIds.has(roleId));
      if (unknown.length > 0) {
        return problemJson(c, {
          type: "unknown-role",
          title: "Unknown role",
          status: 422,
          detail: `This firm has no role with the handle ${unknown[0]}.`,
        });
      }

      const held = await readMemberRoleIds(firm.firmDatabase, subjectUserId);
      const heldSet = new Set(held);
      const targetSet = new Set(target);
      const toAdd = target.filter((roleId) => !heldSet.has(roleId));
      const toRemove = held.filter((roleId) => !targetSet.has(roleId));

      if (toAdd.length === 0 && toRemove.length === 0) {
        // Nothing to change, so nothing to audit: a redelivered no-op would otherwise put a role
        // change in the log that nobody made.
        return c.json({ userId: subjectUserId, roleIds: held.toSorted() }, 200);
      }

      const now = new Date().toISOString();
      // The last-administrator rule, asked of the state the write would LEAVE. Only an ACTIVE
      // member counts as one, so a deactivated subject can never be the firm's last administrator
      // and their roles move freely.
      if (status === "active") {
        const wouldStillAdminister = await rolesCarryPermission(
          firm.firmDatabase,
          target,
          MANAGE_PERMISSION,
        );
        if (
          !wouldStillAdminister &&
          !(await anotherAdministratorRemains(firm.firmDatabase, subjectUserId, now))
        ) {
          return lastAdministratorProblem(
            c,
            "This member is the only one who can administer the firm's members. Give another " +
              "active member that role first, then change this one.",
          );
        }
      }

      const idempotency = requireChokepointIdempotency(c);
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => new Date().toISOString(),
        effect: () => {
          const timestamp = new Date().toISOString();
          return Promise.resolve({
            write: {
              statements: [
                ...toRemove.map((roleId) =>
                  deleteRoleAssignmentStatement(
                    firm.firmDatabase,
                    subjectUserId,
                    assertIdentifier<"role">(roleId, "role"),
                  ),
                ),
                ...toAdd.map((roleId) =>
                  insertRoleAssignmentStatement(firm.firmDatabase, {
                    id: newIdentifier("memberRole"),
                    memberUserId: subjectUserId,
                    roleId: assertIdentifier<"role">(roleId, "role"),
                  }),
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "member.roles_changed",
                  actorUserId,
                  subjectId: subjectUserId,
                  // Both sides of the change, so the log answers "what did they hold before this"
                  // without replaying every earlier row. Handles only; nothing a person typed.
                  metadata: { from: held.toSorted(), to: target.toSorted() },
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify({
              userId: subjectUserId,
              roleIds: target.toSorted(),
            }),
          });
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const settled = await readMemberRoleIds(firm.firmDatabase, subjectUserId);
      return c.json({ userId: subjectUserId, roleIds: settled.toSorted() }, 200);
    },
  );

  registerStatusRoute(app, chokepoint, "deactivated");
  registerStatusRoute(app, chokepoint, "active");
}

/**
 * Deactivation and reactivation are one handler under two doors: the same lookup, the same
 * self-administration refusal, the same audited single-statement write, differing only in the
 * status they set and in which of them has to answer the last-administrator question. Writing them
 * twice would be two places for the refusals to drift.
 */
function registerStatusRoute(
  app: AdministrationApp,
  chokepoint: Chokepoint,
  target: "active" | "deactivated",
): void {
  const route = target === "deactivated" ? deactivateRoute : reactivateRoute;
  app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const actorUserId = requireChokepointUserId(c);
    const subjectUserId = c.req.valid("param").userId;

    if (subjectUserId === actorUserId) {
      return problemJson(c, {
        type: "self-administration",
        title: "A member cannot change their own membership",
        status: 403,
        detail: "Ask another member who can administer the firm.",
      });
    }

    const status = await readMemberStatus(firm.firmDatabase, subjectUserId);
    if (status === null) {
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: "No such member in this firm.",
      });
    }
    if (status === target) {
      // Already where the caller wants them. Answered, not refused — the state they asked for is
      // the state that holds — and audited as nothing, because nothing changed.
      return c.json({ userId: subjectUserId, status }, 200);
    }

    const now = new Date().toISOString();
    if (
      target === "deactivated" &&
      !(await anotherAdministratorRemains(firm.firmDatabase, subjectUserId, now))
    ) {
      return lastAdministratorProblem(
        c,
        "This member is the only active one who can administer the firm's members. Give another " +
          "member that role first, then deactivate this one.",
      );
    }

    const idempotency = requireChokepointIdempotency(c);
    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: () => {
        const timestamp = new Date().toISOString();
        return Promise.resolve({
          write: {
            statements: [
              setMemberStatusStatement(firm.firmDatabase, subjectUserId, target),
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: target === "deactivated" ? "member.deactivated" : "member.reactivated",
                actorUserId,
                subjectId: subjectUserId,
                metadata: null,
                now: timestamp,
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 200,
          responseBody: canonicalJsonStringify({ userId: subjectUserId, status: target }),
        });
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemResponseForIdempotencyConflict(c, result);
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json({ userId: subjectUserId, status: target }, 200);
  });
}
