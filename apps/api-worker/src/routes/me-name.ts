import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuthAuditStatement } from "@magna-carta/data-access/auth-audit-statements";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { renderPersonName } from "@magna-carta/directory/person-name";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// A MEMBER'S OWN NAME — the one record on this platform whose subject is always the person asking.
//
// It is held as parts (prefix, given, middle, family, suffix) beside the single rendered line the
// rest of the platform reads, because a member's name is what letterhead, a pleading's signature
// block and every generated document print, and what a roster sorts by. The rendered line is
// written HERE, in the same statement as the parts, so the two cannot drift; nothing downstream
// re-derives it.
//
// TWO STORES, ONE ACT. The name lives on the control-plane user row (Better Auth's own `name`
// column, and the five parts beside it) and is mirrored into the firm's per-firm `member` row as
// `display_name`, which is what every screen resolving a colleague reads. Both are written on a
// save. They are separate databases and cannot ride one batch, so the control plane is written
// first and the mirror second: a mirror that fails leaves the member's own record correct and the
// roster one save behind, which the next save repairs. The reverse ordering would show colleagues a
// name the person never saved.
//
// WHY THIS TAKES A PERMISSION AT ALL, when the actor is the subject: the chokepoint refuses an
// authenticated mutation naming none, and the platform has no self-scoped mutation concept. So the
// key is `firm:editOwnProfile`, seeded to every default role including Read-only — writing one's
// own name is not a privilege — and every statement below is scoped to the session's own user id,
// which is what makes the key safe to give everybody.

const PERMISSION = "firm:editOwnProfile" as const;

/** The parts, each nullable. A part absent is a part the person has not stated. */
const NamePartFields = z.object({
  prefix: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .openapi({
      description:
        "What goes before the name, as the whole line: several honorifics is ordinary, and the line " +
        "as written is what is printed. Free text — the suggestions a screen offers constrain nothing.",
    }),
  given: z.string().trim().max(200).nullable(),
  middle: z.string().trim().max(200).nullable(),
  family: z.string().trim().max(200).nullable(),
  suffix: z.string().trim().max(100).nullable().openapi({
    description: 'What follows the name, as the whole line — "III, Esq." is one person\'s suffix.',
  }),
});

const MemberNameResponse = z
  .object({
    parts: NamePartFields,
    displayName: z.string().openapi({
      description:
        "The line the parts read as, and what the platform prints. Rendered from the parts where " +
        "the person has stated any; otherwise the name their account was created with.",
    }),
    partsStated: z.boolean().openapi({
      description:
        "Whether the person has ever stated their parts. False means the display name is the one " +
        "line their account was created with, and a screen may offer a reading of it for them to " +
        "confirm — never store one on their behalf.",
    }),
  })
  .openapi("MemberNameResponse");

const SetMemberNameRequest = NamePartFields.openapi("SetMemberNameRequest");

const errorResponses = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:editOwnProfile",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, or the session member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request body is invalid, or every part is empty",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readMeta: RouteMeta = {
  operationId: "me.name",
  surface: "app",
  authenticated: true,
  // A read of one's own row, on the members.professionalProfile precedent: there is no capability
  // to name for reading what you yourself typed.
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const setMeta: RouteMeta = {
  operationId: "me.setName",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited on the control plane rather than in the firm: a name change is a fact about the
  // ACCOUNT, and the auth audit is where the account's own history lives.
  audited: true,
  // Deliberately optional. The write is a total replacement of one row's five columns by the person
  // those columns describe — running it twice lands the same row — so demanding a header would turn
  // a retried save into a 400 for no safety gained.
  idempotency: "optional",
  rateLimit: "default",
};

const readRoute = defineOpenAPIRoute(readMeta, {
  method: "get",
  path: "/api/v1/me/name",
  description:
    "The session member's own name: the parts they have stated, the line those parts read as, and " +
    "whether they have ever stated them. A person who has not reads the single name their account " +
    "was created with, and their parts read as null — never as a guess at how that line splits.",
  responses: {
    200: {
      description: "The member's name",
      content: { "application/json": { schema: MemberNameResponse } },
    },
    401: errorResponses[401],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const setRoute = defineOpenAPIRoute(setMeta, {
  method: "put",
  path: "/api/v1/me/name",
  description:
    "Sets the session member's own name, as the whole set of parts. The rendered line is composed " +
    "from them in the same statement, so what the platform prints and what the person stated can " +
    "never disagree, and the firm's roster is updated to match. Refused when every part is empty: " +
    "a person always has a name, and clearing it would leave every record they touched unnamed.",
  request: {
    body: { required: true, content: { "application/json": { schema: SetMemberNameRequest } } },
  },
  responses: {
    200: {
      description: "The member's name after the write",
      content: { "application/json": { schema: MemberNameResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type NameApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

interface UserNameRow {
  readonly name: string;
  readonly name_prefix: string | null;
  readonly name_given: string | null;
  readonly name_middle: string | null;
  readonly name_family: string | null;
  readonly name_suffix: string | null;
}

/** Null where the trimmed text says nothing, so "" and "   " and absent are one stored state. */
function stated(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function bodyFromRow(row: UserNameRow): z.infer<typeof MemberNameResponse> {
  const parts = {
    prefix: row.name_prefix,
    given: row.name_given,
    middle: row.name_middle,
    family: row.name_family,
    suffix: row.name_suffix,
  };
  const rendered = renderPersonName(parts);
  return {
    parts,
    // The stored `name` is the fallback and not the answer: where parts exist the row's own `name`
    // was rendered from them by the write below, so the two agree and either would do.
    displayName: rendered === "" ? row.name : rendered,
    partsStated: rendered !== "",
  };
}

async function readUserNameRow(
  database: D1Database,
  userId: string,
): Promise<UserNameRow | undefined> {
  const row = await database
    .prepare(
      'SELECT name, name_prefix, name_given, name_middle, name_family, name_suffix FROM "user" WHERE id = ?1',
    )
    .bind(userId)
    .first<UserNameRow>();
  return row ?? undefined;
}

export function registerMeNameRoutes(app: NameApp, chokepoint: Chokepoint): void {
  // GET /api/v1/me/name
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const row = await readUserNameRow(c.env.DB_CONTROL, userId);
      if (row === undefined) {
        // The session resolved a user the control plane no longer holds. Absent, never an oracle.
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "This account could not be read.",
        });
      }
      return c.json(bodyFromRow(row), 200);
    },
  );

  // PUT /api/v1/me/name
  app.openapi(
    { ...setRoute, middleware: chokepointMiddleware(chokepoint, setRoute) },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firm = requireChokepointFirmContext(c);
      const submitted = c.req.valid("json");
      const parts = {
        prefix: stated(submitted.prefix),
        given: stated(submitted.given),
        middle: stated(submitted.middle),
        family: stated(submitted.family),
        suffix: stated(submitted.suffix),
      };
      const displayName = renderPersonName(parts);
      if (displayName === "") {
        return problemJson(c, {
          type: "validation",
          title: "A name is required",
          status: 422,
          detail:
            "Give at least one part of your name. Clearing it would leave your records unnamed.",
        });
      }

      const now = new Date().toISOString();
      // Through the data-access handle rather than the raw binding, so the audit statement builder and
      // the update sit in one array of the same shape.
      const control: BatchDatabase = c.env.DB_CONTROL;
      // One control-plane batch: the parts, the rendered line Better Auth reads, and the audit row
      // recording that the account's own name changed.
      await control.batch([
        control
          .prepare(
            'UPDATE "user" SET name = ?2, name_prefix = ?3, name_given = ?4, name_middle = ?5, name_family = ?6, name_suffix = ?7, updated_at = ?8 WHERE id = ?1',
          )
          .bind(
            userId,
            displayName,
            parts.prefix,
            parts.given,
            parts.middle,
            parts.family,
            parts.suffix,
            Date.now(),
          ),
        insertAuthAuditStatement(control, {
          id: newIdentifier("authAudit"),
          event: "member.name_changed",
          userId,
          // The rendered line only. The parts are the same fact said five ways, and an audit row is
          // read by a person asking what somebody is now called.
          metadata: { displayName },
          now,
        }),
      ]);

      // The roster's mirror, second and separately — see the ordering note at the top of this file.
      // A failure here leaves the member's own record correct and the roster one save behind, which
      // is why it does not fail the request.
      try {
        await firm.firmDatabase
          .prepare("UPDATE member SET display_name = ?2 WHERE user_id = ?1")
          .bind(userId, displayName)
          .run();
      } catch {
        // Swallowed deliberately: the name IS saved, and telling somebody their save failed when it
        // did not is worse than a roster that catches up on the next one.
      }

      const row = await readUserNameRow(c.env.DB_CONTROL, userId);
      return c.json(
        row === undefined ? { parts, displayName, partsStated: true } : bodyFromRow(row),
        200,
      );
    },
  );
}
