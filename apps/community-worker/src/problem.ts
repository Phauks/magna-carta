// RFC 9457 Problem Details, the platform's one error shape, in the small form this worker needs.
//
// It is a local copy rather than an import from the application worker for the same reason the
// whole deployable is separate: this worker depends on nothing that can reach a firm's data, and
// the application worker's problem module carries its telemetry and identifier machinery with it.
// The wire shape is what has to match, and it does.
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";

export type ProblemStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

// The board's problem types. The slug is the public contract — it goes in a URI a client may match
// on — so adding one is a contract change and renaming one is a breaking change.
export const PROBLEM_TYPES = {
  validation: "validation",
  unauthenticated: "unauthenticated",
  notFound: "not-found",
  conflict: "conflict",
  rateLimited: "rate-limited",
  // The read-only kill switch is on. Its own type rather than a 503, because a client should be
  // able to tell "the board is deliberately paused" from "the board is broken", and show the
  // operator's notice rather than a retry spinner.
  boardReadOnly: "community-board-read-only",
  // The account may read but not write: barred by an operator, or not yet a provisioned firm
  // member. Distinct from unauthenticated, because signing in again will not help.
  writeRefused: "community-write-refused",
  // The post was accepted and is held until somebody looks at it. Not an error in the ordinary
  // sense, which is why it is a 202 carrying this shape rather than a 4xx.
  heldForReview: "community-held-for-review",
} as const;

export type ProblemTypeKey = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

const PROBLEM_TYPE_BASE = "https://api.magnacarta.esq/problems/";

export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    errorId: z.string(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), detail: z.string() }))
      .optional(),
    retryAfterSeconds: z.number().int().min(0).optional(),
    // The operator's own words when the board is read-only, so a member is told what is happening
    // rather than shown a generic refusal.
    refusalNotice: z.string().optional(),
  })
  .openapi("Problem");

// A correlation handle for the reply, so a member reporting "it said no" can be joined to the
// server's own record of the refusal. Random rather than derived: nothing about the request should
// be reconstructable from the identifier a member reads out over the telephone.
function newErrorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `error_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function problemJson(
  c: Context,
  input: {
    type: ProblemTypeKey;
    status: ProblemStatusCode;
    title: string;
    detail?: string;
    errors?: { path: string; code: string; detail: string }[];
    retryAfterSeconds?: number;
    refusalNotice?: string;
  },
): Response {
  const body = {
    type: `${PROBLEM_TYPE_BASE}${input.type}`,
    title: input.title,
    status: input.status,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    errorId: newErrorId(),
    instance: new URL(c.req.url).pathname,
    ...(input.errors === undefined ? {} : { errors: input.errors }),
    ...(input.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: input.retryAfterSeconds }),
    ...(input.refusalNotice === undefined ? {} : { refusalNotice: input.refusalNotice }),
  };
  return new Response(JSON.stringify(body), {
    status: input.status,
    headers: {
      "content-type": "application/problem+json",
      // A refusal must never be cached or indexed. The board-wide headers are applied by the
      // application's own middleware too; they are repeated here because a problem reply can be
      // produced before that middleware's response phase in some short-circuit paths.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
