import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import { insertConnectionStatement } from "@magna-carta/data-access/integration-connection-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import type { HttpClient } from "@magna-carta/shipping/easypost/http";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Shipping & postage: connect the firm's EasyPost postage account, then create/rate/buy/track/refund
// shipments. The API key is stored as a firm secret (never logged); the live carrier calls run
// through the resolved ShippingPort. Every route requires shipping:manage. The secretStoreForFirm and
// httpClient are injected so production swaps the real firm_secret store (slice 1·2) and tests inject
// a fake EasyPost.

export interface ShippingRouteDeps {
  readonly secretStoreForFirm: (firmDatabase: unknown) => SecretStore;
  readonly httpClient: HttpClient;
}

type ShippingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
const MANAGE = "shipping:manage" as const;

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
    description: "The session member lacks shipping:manage",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the shipment is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, or the postage account is not connected",
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

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const ConnectRequest = z.object({ apiKey: z.string().min(1) }).openapi("ShippingConnectRequest");
const ConnectAck = z.object({ id: z.string(), status: z.string() }).openapi("ShippingConnectAck");

const connectRoute = defineOpenAPIRoute(writeMeta("shipping.connect"), {
  method: "post",
  path: "/api/v1/integrations/shipping/connection",
  description:
    "Connects the firm's EasyPost postage account by storing its API key as a firm secret.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ConnectRequest } }, required: true },
  },
  responses: {
    201: { description: "Connected", content: { "application/json": { schema: ConnectAck } } },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

export function registerShippingRoutes(
  app: ShippingApp,
  chokepoint: Chokepoint,
  deps: ShippingRouteDeps,
): void {
  // POST /api/v1/integrations/shipping/connection — store the API key + record the connection
  app.openapi(
    { ...connectRoute, middleware: chokepointMiddleware(chokepoint, connectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      // Read to satisfy the audited-route contract; the connection row's principal is the firm.
      requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { apiKey } = c.req.valid("json");
      const now = () => new Date().toISOString();
      const secrets = deps.secretStoreForFirm(firm.firmDatabase);
      const descriptor = createEasyPostAdapter({ http: deps.httpClient }).descriptor;

      const connectionId = newIdentifier("integrationConnection");
      const credentialRef = `integration:shipping:${connectionId}`;
      // Store the secret first (idempotent by ref), then commit the connection row in the effect batch.
      await secrets.putSecret(credentialRef, JSON.stringify({ kind: "apiKey", apiKey }));

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: {
            statements: [
              insertConnectionStatement(firm.firmDatabase, {
                id: connectionId,
                category: "shipping",
                adapterId: "easypost",
                scope: "firm",
                principalRef: firmId,
                credentialRef,
                capabilitySnapshot: JSON.stringify(descriptor),
                createdAt: now(),
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 201,
          responseBody: canonicalJsonStringify({ id: connectionId, status: "connected" }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ConnectAck>, 201);
    },
  );
}
