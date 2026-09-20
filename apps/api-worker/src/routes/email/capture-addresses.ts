import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import type { Context } from "hono";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  readActiveCatchAllCaptureAddress,
  readCaptureAddressById,
  readMatterCaptureAddresses,
} from "@magna-carta/data-access/email-filing-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  captureAddressFor,
  DEFAULT_CAPTURE_ROOT_DOMAIN,
} from "@magna-carta/email-filing/capture-address";
import { maskCaptureToken } from "@magna-carta/email-filing/capture-token";
import { selectMatterStatement } from "@magna-carta/matters/matter-statements";
import type {
  EmailCaptureAddressId,
  FirmId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  composeCaptureAddressMint,
  composeCaptureAddressRevoke,
  revokeCaptureRouteFirst,
  summarizeCaptureAddress,
} from "../../emails/capture-address-service.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// The capture-address surface: the writer for the forward/CC token index. Minting an address is what
// makes `<token>@<capture zone>` deliver into a matter; without it the routing index is empty and
// every forwarded message bounces.
//
// THE TOKEN IS THE CREDENTIAL. Anyone who knows it can post mail into the firm, so it is returned
// exactly once — in the response to the mint or rotate that created it — and never read back. Lists
// return a short prefix plus metadata, which is enough to tell two addresses apart and nowhere near
// enough to guess one.
//
// A capture address spans two databases with no shared transaction, and the two directions take
// deliberately OPPOSITE orders (the reasoning lives with the composition, in
// ../emails/capture-address-service.ts): mint commits per-firm-plus-outbox and converges through the
// relay; revoke and rotate stop routing in the control plane first, and fail closed.

const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const addressParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  emailCaptureAddressId: identifierPathParam("emailCaptureAddress", "emailCaptureAddressId"),
});

const MintedCaptureAddress = z
  .object({
    emailCaptureAddressId: z.string(),
    kind: z.enum(["matter", "catchAll"]),
    matterId: z.string().nullable(),
    // The address to forward or CC mail to. Shown once: this response is the only place the full
    // token is ever returned.
    address: z.string(),
    token: z.string(),
    // False until the routing index has been written, which happens off the request path. The address
    // is real either way; mail sent before it flips is bounced rather than lost.
    routable: z.literal(false),
    createdAt: z.string(),
  })
  .openapi("MintedCaptureAddress");

const CaptureAddressSummary = z
  .object({
    emailCaptureAddressId: z.string(),
    kind: z.enum(["matter", "catchAll"]),
    matterId: z.string().nullable(),
    active: z.boolean(),
    // The leading characters of the token, never the token: enough to identify a row, not to use it.
    tokenPreview: z.string(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    rotatedAt: z.string().nullable(),
  })
  .openapi("CaptureAddressSummary");

const CaptureAddressList = z
  .object({ data: z.array(CaptureAddressSummary) })
  .openapi("CaptureAddressList");

const RevokedCaptureAddress = z
  .object({ emailCaptureAddressId: z.string(), active: z.literal(false) })
  .openapi("RevokedCaptureAddress");

const MANAGE = "emails:manageCaptureAddresses" as const;

// ── RouteMeta.
//
// The matter-scoped operations carry resource "matter", like the rest of the emails family. The two
// catch-all operations carry resource "firm", and that is not a slip: a catch-all has no matter
// (matter_id is null by construction) and its tenancy root really is the firm, so binding it to
// "matter" would name a resource that does not exist for it. The conformance suite's
// namespace→resource map admits both for emails because of exactly this split.
//
// Minting and rotating create a bearer credential, so both declare idempotency "required" — a
// double-submitted mint must return the first token rather than strand a second live address, and a
// double-submitted rotate must not retire the token the caller was just shown. Revoking is idempotent
// by construction (every statement is guarded on the row still being live), so it stays optional.

const mintMeta: RouteMeta = {
  operationId: "emails.mintCaptureAddress",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  rateLimit: "default",
};

const listMeta: RouteMeta = {
  operationId: "emails.listCaptureAddresses",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const rotateMeta: RouteMeta = {
  operationId: "emails.rotateCaptureAddress",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "required",
  rateLimit: "default",
};

const revokeMeta: RouteMeta = {
  operationId: "emails.revokeCaptureAddress",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const mintCatchAllMeta: RouteMeta = {
  operationId: "emails.mintFirmCaptureAddress",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "firm",
  audited: true,
  idempotency: "required",
  rateLimit: "default",
};

const revokeCatchAllMeta: RouteMeta = {
  operationId: "emails.revokeFirmCaptureAddress",
  surface: "app",
  authenticated: true,
  permission: MANAGE,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const sharedResponses = {
  401: {
    description: "No session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "Missing emails:manageCaptureAddresses",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const mintCatchAllRoute = defineOpenAPIRoute(mintCatchAllMeta, {
  method: "post",
  path: "/api/v1/firm/capture-address",
  description:
    "Mint the firm's catch-all capture address. Mail forwarded to it is captured for the firm with " +
    "no candidate matter, for staff to route. A firm holds at most one live catch-all; revoke the " +
    "existing one first. The full token is returned only in this response.",
  request: { headers: idempotencyKeyHeader },
  responses: {
    201: {
      description: "The minted catch-all address, with its token shown once",
      content: { "application/json": { schema: MintedCaptureAddress } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    ...sharedResponses,
    409: {
      description:
        "The firm already holds a live catch-all address, or a request with this Idempotency-Key " +
        "is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const revokeCatchAllRoute = defineOpenAPIRoute(
  { ...revokeCatchAllMeta, reversal: { kind: "inverse", by: "emails.mintFirmCaptureAddress" } },
  {
    method: "delete",
    path: "/api/v1/firm/capture-address",
    description:
      "Revoke the firm's catch-all capture address. Routing stops first, so mail to the old address " +
      "bounces from the moment this returns. Revoking one that is already revoked succeeds.",
    responses: {
      200: {
        description: "The catch-all no longer routes (or already did not)",
        content: { "application/json": { schema: RevokedCaptureAddress } },
      },
      ...sharedResponses,
      404: {
        description: "The firm holds no live catch-all address",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

const mintRoute = defineOpenAPIRoute(mintMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/capture-addresses",
  description:
    "Mint a forward/CC capture address for this matter. Mail forwarded or CC'd to the returned " +
    "address is captured and staged onto the matter. The full token is returned only in this " +
    "response — later reads show a masked form, because the token is itself the credential.",
  request: { params: matterParam, headers: idempotencyKeyHeader },
  responses: {
    201: {
      description: "The minted address, with its token shown once",
      content: { "application/json": { schema: MintedCaptureAddress } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    ...sharedResponses,
    404: {
      description: "Unknown matter",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/capture-addresses",
  description:
    "List this matter's capture addresses, live and retired, newest first. Token values are never " +
    "returned — each row carries a short prefix and its metadata.",
  request: { params: matterParam },
  responses: {
    200: {
      description: "The matter's capture addresses",
      content: { "application/json": { schema: CaptureAddressList } },
    },
    ...sharedResponses,
  },
});

const rotateRoute = defineOpenAPIRoute(rotateMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/capture-addresses/{emailCaptureAddressId}/rotate",
  description:
    "Rotate a capture address: the old token stops routing and a fresh one is minted for the same " +
    "matter, returned here. Use this when an address has been over-shared. Replaying the same " +
    "Idempotency-Key returns the same new token rather than rotating twice.",
  request: { params: addressParam, headers: idempotencyKeyHeader },
  responses: {
    201: {
      description: "The replacement address, with its token shown once",
      content: { "application/json": { schema: MintedCaptureAddress } },
    },
    400: {
      description: "Missing Idempotency-Key (this operation requires one)",
      content: { "application/problem+json": { schema: Problem } },
    },
    ...sharedResponses,
    404: {
      description: "No live capture address with this handle on this matter",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The Idempotency-Key was reused with a different payload",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const revokeRoute = defineOpenAPIRoute(
  { ...revokeMeta, reversal: { kind: "inverse", by: "emails.mintCaptureAddress" } },
  {
    method: "delete",
    path: "/api/v1/matters/{matterId}/capture-addresses/{emailCaptureAddressId}",
    description:
      "Revoke a capture address. Routing stops first, so mail to it bounces from the moment this " +
      "returns; already-captured messages are untouched. Revoking one that is already revoked succeeds.",
    request: { params: addressParam },
    responses: {
      200: {
        description: "The address no longer routes (or already did not)",
        content: { "application/json": { schema: RevokedCaptureAddress } },
      },
      ...sharedResponses,
      404: {
        description: "No capture address with this handle on this matter",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

// ── Shared commit paths. Both helpers exist so the six handlers cannot drift on the one thing that
// must never drift: the order the two databases are written in.

type CaptureAddressContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

interface MintedBody {
  readonly emailCaptureAddressId: string;
  readonly kind: "matter" | "catchAll";
  readonly matterId: string | null;
  readonly address: string;
  readonly token: string;
  readonly routable: false;
  readonly createdAt: string;
}

// The commit's two outcomes, kept as a discriminated union rather than an optional-field pair so the
// handler's `return` stays status-typed for app.openapi — a bare `Response` would erase the response
// types the emitted contract is generated from.
type MintOutcome =
  | { readonly ok: true; readonly body: MintedBody }
  | { readonly ok: false; readonly problem: ProblemResponse<409> | ProblemResponse<422> };

// Raised INSIDE the effect when the address a rotate names is gone, or was never this matter's.
// Thrown rather than returned so nothing commits and no idempotency record is stored: a miss is not
// an outcome worth replaying, and a later retry should re-evaluate the address rather than be
// answered from a cached absence. It propagates out of mintAndCommit to the ONE caller that can
// produce it (rotate), so the plain mint paths keep a response set with no unreachable 404 in it.
class CaptureAddressNotFoundError extends Error {
  constructor() {
    super("no live capture address with this handle on this matter");
  }
}

interface MintAndCommitInput {
  readonly firmId: FirmId;
  readonly kind: "matter" | "catchAll";
  readonly matterId: MatterId | null;
  readonly createdBy: UserId;
  readonly idempotency: { key: string | undefined; fingerprint: string };
  // Runs INSIDE the effect, and only when the effect actually executes. It returns the per-firm
  // statements that must commit WITH the new address — a rotate's retirement of the address being
  // replaced, so the matter is never briefly without one or briefly holding two — and it is where a
  // rotate performs its control-plane revoke. Being inside the effect is what makes a REPLAYED rotate
  // return the same replacement token: the idempotency pre-check answers first, so the second request
  // never re-reads an address the first one already retired and never reports its own work missing.
  readonly prepareRetirement?: () => Promise<readonly EffectStatement[]>;
  readonly rotatedFrom?: EmailCaptureAddressId;
}

// Mint an address and commit it: the per-firm row, any retirement it replaces, the audit entry, the
// outbox row that will make it routable, and the idempotency record — one atomic batch. A replay of
// the same Idempotency-Key returns the stored response, so the caller sees the SAME token rather than
// a second live address. That stored body holds the token, which is why an idempotency response body
// is only ever readable by the firm that produced it: it lives in that firm's own database, beside
// the address row that already holds the same value.
async function mintAndCommit(
  c: CaptureAddressContext,
  input: MintAndCommitInput,
): Promise<MintOutcome> {
  const firm = requireChokepointFirmContext(c);
  const rootDomain = c.env.CAPTURE_ROOT_DOMAIN ?? DEFAULT_CAPTURE_ROOT_DOMAIN;
  const now = () => new Date().toISOString();

  const result = await runIdempotentEffect({
    database: firm.firmDatabase,
    key: input.idempotency.key,
    fingerprint: input.idempotency.fingerprint,
    now,
    effect: async () => {
      const createdAt = now();
      // The retirement half of a rotate runs first and commits its control-plane revoke outright,
      // so the old token stops routing before the replacement is even composed.
      const retireStatements = (await input.prepareRetirement?.()) ?? [];
      const mint = await composeCaptureAddressMint(
        c.env.DB_CONTROL,
        firm.firmDatabase,
        {
          firmId: input.firmId,
          kind: input.kind,
          matterId: input.matterId,
          createdBy: input.createdBy,
        },
        createdAt,
      );
      const body: MintedBody = {
        emailCaptureAddressId: mint.emailCaptureAddressId,
        kind: input.kind,
        matterId: input.matterId,
        address: captureAddressFor(mint.token, rootDomain),
        token: mint.token,
        // Always false at mint time: the routing index is written by the relay, off this path.
        routable: false,
        createdAt,
      };
      return {
        write: {
          statements: [
            ...retireStatements,
            ...mint.statements,
            domainAuditStatement(firm.firmDatabase, {
              event:
                input.rotatedFrom === undefined
                  ? "emails.capture_address_minted"
                  : "emails.capture_address_rotated",
              subjectId: mint.emailCaptureAddressId,
              actorUserId: input.createdBy,
              clock: { now },
              // The token is deliberately absent: an audit entry is read by more people than the
              // mint response, and the token is a credential.
              metadata: {
                kind: input.kind,
                matterId: input.matterId,
                ...(input.rotatedFrom === undefined ? {} : { rotatedFrom: input.rotatedFrom }),
              },
            }),
          ],
          outboxMessages: mint.outboxMessages,
        },
        responseCode: 201,
        responseBody: canonicalJsonStringify(body),
      };
    },
  });

  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return { ok: true, body: JSON.parse(result.responseBody ?? "{}") as MintedBody };
}

interface RevokeAndCommitInput {
  readonly firmId: FirmId;
  readonly userId: UserId;
  readonly emailCaptureAddressId: EmailCaptureAddressId;
  readonly token: string;
  readonly matterId: MatterId | null;
  readonly kind: "matter" | "catchAll";
}

// Revoke an address, control plane FIRST. The order is the security property: the routing row flips
// before the per-firm row does, so the token has stopped delivering mail by the time anything else can
// fail. Both statements are guarded on the row still being live, so this is safe to call twice — and a
// caller that retries after a partial failure simply finishes the job.
async function revokeAndCommit(
  c: CaptureAddressContext,
  input: RevokeAndCommitInput,
): Promise<void> {
  const firm = requireChokepointFirmContext(c);
  const now = () => new Date().toISOString();
  const at = now();
  await revokeCaptureRouteFirst(c.env.DB_CONTROL, input.firmId, input.token, at);
  await commitEffectBatch(
    firm.firmDatabase,
    {
      statements: [
        ...composeCaptureAddressRevoke(firm.firmDatabase, input.emailCaptureAddressId, at),
        domainAuditStatement(firm.firmDatabase, {
          event: "emails.capture_address_revoked",
          subjectId: input.emailCaptureAddressId,
          actorUserId: input.userId,
          clock: { now },
          metadata: { kind: input.kind, matterId: input.matterId },
        }),
      ],
      outboxMessages: [],
    },
    { now },
  );
}

export function registerCaptureAddressRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // The firm catch-all routes are registered FIRST and their path is fully static, so no
  // parameterized sibling can ever shadow them. (A parameterized route registered ahead of a static
  // one on the same prefix swallows it, which is how a previous route ended up 422-ing on a literal
  // segment parsed as a handle.)

  // POST /firm/capture-address — mint the firm catch-all.
  app.openapi(
    { ...mintCatchAllRoute, middleware: chokepointMiddleware(chokepoint, mintCatchAllRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);

      const existing = await readActiveCatchAllCaptureAddress(firm.firmDatabase);
      if (existing !== null) {
        return problemJson(c, {
          type: "conflict",
          title: "The firm already has a catch-all address",
          status: 409,
          detail:
            "A firm holds at most one live catch-all capture address. Revoke the existing one " +
            "before minting a replacement.",
        });
      }

      const minted = await mintAndCommit(c, {
        firmId,
        kind: "catchAll",
        matterId: null,
        createdBy: userId,
        idempotency,
      });
      return minted.ok ? c.json(minted.body, 201) : minted.problem;
    },
  );

  // DELETE /firm/capture-address — revoke the firm catch-all.
  app.openapi(
    { ...revokeCatchAllRoute, middleware: chokepointMiddleware(chokepoint, revokeCatchAllRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const existing = await readActiveCatchAllCaptureAddress(firm.firmDatabase);
      if (existing === null) {
        return problemJson(c, {
          type: "not-found",
          title: "No catch-all address",
          status: 404,
          detail: "This firm holds no live catch-all capture address.",
        });
      }
      await revokeAndCommit(c, {
        firmId,
        userId,
        emailCaptureAddressId: existing.id,
        token: existing.token,
        matterId: null,
        kind: "catchAll",
      });
      return c.json({ emailCaptureAddressId: existing.id, active: false as const }, 200);
    },
  );

  // POST /matters/{matterId}/capture-addresses — mint a matter address.
  app.openapi(
    { ...mintRoute, middleware: chokepointMiddleware(chokepoint, mintRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { matterId } = c.req.valid("param");
      const idempotency = requireChokepointIdempotency(c);

      // A token that proposes a matter which does not exist would capture mail into nothing, so the
      // matter is confirmed before anything is minted.
      const matter = await selectMatterStatement(firm.firmDatabase, matterId).all<{ id: string }>();
      if (matter.results[0] === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Matter not found",
          status: 404,
          detail: "No such matter.",
        });
      }

      const minted = await mintAndCommit(c, {
        firmId,
        kind: "matter",
        matterId,
        createdBy: userId,
        idempotency,
      });
      return minted.ok ? c.json(minted.body, 201) : minted.problem;
    },
  );

  // GET /matters/{matterId}/capture-addresses — the matter's addresses, tokens masked.
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const rows = await readMatterCaptureAddresses(firm.firmDatabase, matterId);
      return c.json(
        { data: rows.map((row) => summarizeCaptureAddress(row, maskCaptureToken)) },
        200,
      );
    },
  );

  // POST /matters/{matterId}/capture-addresses/{emailCaptureAddressId}/rotate — retire + replace.
  // Registered before the DELETE on the bare handle so the literal /rotate segment can never be read
  // as part of a handle.
  app.openapi(
    { ...rotateRoute, middleware: chokepointMiddleware(chokepoint, rotateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailCaptureAddressId } = c.req.valid("param");
      const idempotency = requireChokepointIdempotency(c);

      // The whole rotate — the lookup, the control-plane revoke, and the replacement — runs inside the
      // idempotent effect, so a replay is answered from the stored response and never re-reads the
      // address the first attempt already retired (which would otherwise report the caller's own
      // completed work as missing).
      let minted;
      try {
        minted = await mintAndCommit(c, {
          firmId,
          kind: "matter",
          matterId,
          createdBy: userId,
          idempotency,
          prepareRetirement: async () => {
            const existing = await readCaptureAddressById(firm.firmDatabase, emailCaptureAddressId);
            if (existing === null || existing.matterId !== matterId || !existing.active) {
              throw new CaptureAddressNotFoundError();
            }
            // Control plane FIRST: the old token stops routing before anything else happens, so a
            // failure anywhere below leaves a dead address rather than a live one nobody meant to keep.
            const at = new Date().toISOString();
            await revokeCaptureRouteFirst(c.env.DB_CONTROL, firmId, existing.token, at);
            // The per-firm half is ONE batch with the replacement insert, so a rotate can never leave a
            // matter briefly holding two live addresses or none.
            return composeCaptureAddressRevoke(firm.firmDatabase, existing.id, at);
          },
          rotatedFrom: emailCaptureAddressId,
        });
      } catch (caught) {
        if (caught instanceof CaptureAddressNotFoundError) {
          return problemJson(c, {
            type: "not-found",
            title: "Capture address not found",
            status: 404,
            detail: "No live capture address with this handle on this matter.",
          });
        }
        throw caught;
      }
      return minted.ok ? c.json(minted.body, 201) : minted.problem;
    },
  );

  // DELETE /matters/{matterId}/capture-addresses/{emailCaptureAddressId} — revoke.
  app.openapi(
    { ...revokeRoute, middleware: chokepointMiddleware(chokepoint, revokeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailCaptureAddressId } = c.req.valid("param");
      const existing = await readCaptureAddressById(firm.firmDatabase, emailCaptureAddressId);
      if (existing === null || existing.matterId !== matterId) {
        return problemJson(c, {
          type: "not-found",
          title: "Capture address not found",
          status: 404,
          detail: "No capture address with this handle on this matter.",
        });
      }
      await revokeAndCommit(c, {
        firmId,
        userId,
        emailCaptureAddressId: existing.id,
        token: existing.token,
        matterId: existing.matterId,
        kind: existing.kind,
      });
      return c.json({ emailCaptureAddressId: existing.id, active: false as const }, 200);
    },
  );
}
