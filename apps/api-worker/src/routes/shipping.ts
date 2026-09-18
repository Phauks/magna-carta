import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  deleteConnectionStatement,
  selectConnectionStatement,
  upsertConnectionStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  claimShipmentPurchaseStatement,
  insertTrackingEventStatement,
  markShipmentRatedStatement,
  releaseShipmentPurchaseClaimStatement,
  selectShipmentLabelsStatement,
  selectShipmentStatement,
} from "@magna-carta/data-access/shipment-statements";
import {
  createShipmentDraft,
  recordPurchase,
  recordRefund,
} from "@magna-carta/data-access/shipment-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  IntegrationConnectionId,
  MatterId,
  ShipmentId,
} from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import {
  firmScopedObjectDimensions,
  matterScopedObjectDimensions,
} from "@magna-carta/object-dimensions/dimensions";
import { integrationProblem } from "@magna-carta/integrations/problem";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import type { ShippingPort } from "@magna-carta/shipping/port";
import type { Context } from "hono";
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
import { problemJson, Problem, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import { buildIntegrationRegistry } from "../plugins/registry.ts";
import { protectedReadContext } from "../protected-read-context.ts";
import { deleteIntegrationCredentialStatement } from "@magna-carta/data-access/integration-credential-statements";
import type { PluginRuntime } from "../plugins/runtime.ts";

// Shipping & postage: connect the firm's EasyPost postage account, then create/rate/buy/track/refund
// shipments. The API key is stored as a firm secret (never logged); the live carrier calls run
// through the resolved ShippingPort. Every route requires shipping:manage. The PluginRuntime is
// injected so production swaps the real firm_secret store and tests inject a fake EasyPost.

type ShippingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
const MANAGE = "shipping:manage" as const;

// Where a firm's postage credential is addressed. A firm has at most one postage connection, so the
// ref is derived from the firm rather than minted — which is what makes a reconnect a rotation in
// place and lets the disconnect find the credential it has to clear.
function credentialRefForFirm(firmId: FirmId): string {
  return `integration:shipping:${firmId}`;
}

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
  501: {
    description:
      "This deployment cannot read stored integration credentials, so no account can be connected and no carrier operation can run",
    content: { "application/problem+json": { schema: Problem } },
  },
  502: {
    description: "The postage provider rejected the request or is unavailable",
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
const DisconnectAck = z
  .object({ id: z.string(), status: z.string() })
  .openapi("ShippingDisconnectAck");

const AddressSchema = z.object({
  name: z.string().min(1),
  company: z.string().nullable().optional(),
  street1: z.string().min(1),
  street2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().length(2),
  phone: z.string().nullable().optional(),
});
const ParcelSchema = z.object({
  lengthIn: z.number().positive().optional(),
  widthIn: z.number().positive().optional(),
  heightIn: z.number().positive().optional(),
  weightOz: z.number().positive(),
  predefinedPackage: z.string().nullable().optional(),
});
const OptionsSchema = z.object({
  certifiedMail: z.boolean().optional(),
  returnReceipt: z.enum(["none", "electronic", "physical"]).optional(),
  signatureConfirmation: z.enum(["none", "signature", "adult"]).optional(),
  // The declared value to insure, in integer minor units. Carried onto the label purchase, where the
  // carrier is asked to insure exactly this amount. Negative is meaningless; zero means uninsured.
  insuranceAmountMinor: z.number().int().nonnegative().nullable().optional(),
});
const CreateShipmentRequest = z
  .object({
    matterRef: z.string().nullable().optional(),
    from: AddressSchema,
    to: AddressSchema,
    parcel: ParcelSchema,
    options: OptionsSchema.optional(),
  })
  .openapi("CreateShipmentRequest");
const ShipmentAck = z.object({ id: z.string() }).openapi("ShipmentAck");
const RateSchema = z.object({
  remoteId: z.string(),
  carrier: z.string(),
  service: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  deliveryDays: z.number().nullable(),
  estDeliveryDate: z.string().nullable(),
});
const RatesResponse = z
  .object({ remoteShipmentId: z.string(), rates: z.array(RateSchema) })
  .openapi("ShipmentRates");

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
    501: errorResponses[501],
  },
});

const disconnectCarrierRoute = defineOpenAPIRoute(
  {
    ...writeMeta("shipping.disconnectCarrier"),
    reversal: { kind: "inverse", by: "shipping.connect" },
  },
  {
    method: "delete",
    path: "/api/v1/integrations/shipping/connection",
    description:
      "Disconnects the firm's EasyPost postage account. Shipping operations stop until the account is connected again.",
    request: { headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "Disconnected",
        content: { "application/json": { schema: DisconnectAck } },
      },
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
    },
  },
);

const createShipmentRoute = defineOpenAPIRoute(writeMeta("shipping.createShipment"), {
  method: "post",
  path: "/api/v1/shipments",
  description:
    "Creates a draft shipment (recipient, package, options) optionally linked to a matter.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: CreateShipmentRequest } }, required: true },
  },
  responses: {
    201: { description: "Draft created", content: { "application/json": { schema: ShipmentAck } } },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

// Rate-shop is a read-through to EasyPost (rates are ephemeral, never persisted). It POSTs the package
// but is unaudited with optional idempotency.
const rateRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.rateShipment",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/shipments/{id}/rates",
    description: "Returns live carrier rates for the draft shipment.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Rates", content: { "application/json": { schema: RatesResponse } } },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
      501: errorResponses[501],
      502: errorResponses[502],
    },
  },
);

const PurchaseRequest = z
  .object({
    remoteShipmentId: z.string(),
    remoteRateId: z.string(),
    serviceFeeMinor: z.number().int().nonnegative().default(0),
  })
  .openapi("PurchaseRequest");
const PurchaseAck = z
  .object({ id: z.string(), trackingCode: z.string(), labelId: z.string() })
  .openapi("PurchaseAck");

const purchaseRoute = defineOpenAPIRoute(writeMeta("shipping.purchase"), {
  method: "post",
  path: "/api/v1/shipments/{id}/purchase",
  description: "Buys the chosen rate, stores the label PDF, and records postage + service fee.",
  request: {
    headers: idempotencyKeyHeader,
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: PurchaseRequest } }, required: true },
  },
  responses: {
    200: { description: "Purchased", content: { "application/json": { schema: PurchaseAck } } },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
    501: errorResponses[501],
    502: errorResponses[502],
  },
});

const TrackingResponse = z
  .object({
    events: z.array(
      z.object({
        status: z.string(),
        occurredAt: z.string().nullable(),
        location: z.string().nullable(),
        message: z.string().nullable(),
      }),
    ),
  })
  .openapi("TrackingResponse");
const RefundAck = z.object({ id: z.string(), status: z.string() }).openapi("RefundAck");

// GET label PDF — streamed from per-firm R2.
const labelRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.label",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/shipments/{id}/label",
    description: "Streams the shipment's label PDF.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Label PDF", content: { "application/pdf": { schema: z.string() } } },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      429: errorResponses[429],
    },
  },
);

// Pull tracking live, cache events, return them. POST (it calls EasyPost) but unaudited, optional idempotency.
const trackingRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.tracking",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/shipments/{id}/tracking",
    description: "Pulls and returns current tracking events.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Tracking events",
        content: { "application/json": { schema: TrackingResponse } },
      },
      401: errorResponses[401],
      403: errorResponses[403],
      404: errorResponses[404],
      409: errorResponses[409],
      422: errorResponses[422],
      429: errorResponses[429],
      501: errorResponses[501],
      502: errorResponses[502],
    },
  },
);

// Refund/void an unused label.
const refundRoute = defineOpenAPIRoute(writeMeta("shipping.refund"), {
  method: "post",
  path: "/api/v1/shipments/{id}/refund",
  description: "Voids/refunds the shipment's label.",
  request: { headers: idempotencyKeyHeader, params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Refund submitted",
      content: { "application/json": { schema: RefundAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
    501: errorResponses[501],
    502: errorResponses[502],
  },
});

export function registerShippingRoutes(
  app: ShippingApp,
  chokepoint: Chokepoint,
  runtime: PluginRuntime,
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
      const credentials = runtime.credentialStoreForFirm(protectedReadContext(c));
      const descriptor = createEasyPostAdapter({ http: runtime.httpClient }).descriptor;

      // A firm has at most one postage connection, so the connection row and its credential are both
      // addressed by (category, firm) rather than by a freshly minted id. That makes a reconnect a
      // rotation in place: the new key overwrites the old one at the same ref instead of leaving the
      // revoked key sitting in the credential store under an orphaned reference.
      const existing = await selectConnectionStatement(
        firm.firmDatabase,
        "shipping",
        firmId,
      ).first<{ id: string }>();
      const connectionId =
        existing === null
          ? newIdentifier("integrationConnection")
          : (existing.id as IntegrationConnectionId);
      const credentialRef = credentialRefForFirm(firmId);
      // Store the credential first (idempotent by ref), then commit the connection row in the effect
      // batch. This order is deliberate: a connection row over a key that was never stored would
      // leave the firm believing it had connected an account it had not, while a stored credential
      // with no connection row is inert — nothing resolves it, and the next connect overwrites it.
      await credentials.put(credentialRef, { kind: "apiKey", apiKey });

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: {
            statements: [
              upsertConnectionStatement(firm.firmDatabase, {
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

  // DELETE /api/v1/integrations/shipping/connection — drop the connection so shipping stops resolving
  app.openapi(
    {
      ...disconnectCarrierRoute,
      middleware: chokepointMiddleware(chokepoint, disconnectCarrierRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      // Read to satisfy the audited-route contract; the connection row's principal is the firm.
      requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();

      const existing = await selectConnectionStatement(
        firm.firmDatabase,
        "shipping",
        firmId,
      ).first<{ id: string }>();
      // Nothing connected reads as nothing to disconnect. 404 rather than a success ack, so a
      // caller cannot mistake "there was never a connection" for "the connection was removed".
      if (existing === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No postage account is connected for this firm.",
        });
      }
      const connectionId = existing.id as IntegrationConnectionId;

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          // Deleting the row is what actually severs the integration: resolution reads the
          // connection first, so with no row every shipping operation answers not-connected. The
          // credential goes with it, in the same batch — a member who disconnects an account has
          // usually just revoked the key at the provider, and a revoked bearer secret that outlives
          // the only row pointing at it is sealed material nothing can reach and nothing will clear.
          // A reconnect writes a fresh one at the same ref.
          write: {
            statements: [
              deleteConnectionStatement(firm.firmDatabase, connectionId),
              deleteIntegrationCredentialStatement(firm.firmDatabase, credentialRefForFirm(firmId)),
            ],
            outboxMessages: [],
          },
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id: connectionId, status: "disconnected" }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof DisconnectAck>, 200);
    },
  );

  // POST /api/v1/shipments — create a draft shipment
  app.openapi(
    { ...createShipmentRoute, middleware: chokepointMiddleware(chokepoint, createShipmentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      const now = () => new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const created = await createShipmentDraft(
            firm.firmDatabase,
            {
              matterRef: (body.matterRef ?? null) as MatterId | null,
              fromAddress: JSON.stringify(body.from),
              toAddress: JSON.stringify(body.to),
              parcel: JSON.stringify(body.parcel),
              options: JSON.stringify(body.options ?? {}),
            },
            { clock: { now }, actorUserId: userId },
          );
          return {
            write: created.effect,
            responseCode: 201,
            responseBody: canonicalJsonStringify({ id: created.shipmentId }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ShipmentAck>, 201);
    },
  );

  // POST /api/v1/shipments/{id}/rates — live rate-shop
  app.openapi(
    { ...rateRoute, middleware: chokepointMiddleware(chokepoint, rateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const id = c.req.valid("param").id as ShipmentId;
      const registry = buildIntegrationRegistry(protectedReadContext(c), runtime);
      const resolved = await registry.resolve<ShippingPort>("shipping", { firmId });
      if (!resolved.ok) return shippingDispatchProblem(c, resolved);
      const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
        from_address: string;
        to_address: string;
        parcel: string;
        options: string;
      }>();
      const draft = results[0];
      if (draft === undefined) return notFoundProblem(c);
      const rated = await resolved.value.port.rateShipment({
        from: JSON.parse(draft.from_address),
        to: JSON.parse(draft.to_address),
        parcel: JSON.parse(draft.parcel),
        options: JSON.parse(draft.options),
      });
      if (!rated.ok) return shippingDispatchProblem(c, rated);
      // Rates themselves are ephemeral and never persisted, but the carrier-side shipment they were
      // quoted against is recorded here: it is what the purchase route checks the caller's
      // remoteShipmentId against, so money is only ever spent on a shipment THIS server created for
      // THIS draft. The write is guarded on the pre-purchase statuses, so re-rating a bought
      // shipment changes nothing.
      await markShipmentRatedStatement(
        firm.firmDatabase,
        id,
        rated.value.remoteId,
        new Date().toISOString(),
      ).run();
      return c.json(
        {
          remoteShipmentId: rated.value.remoteId,
          rates: rated.value.rates.map((rate) => ({
            remoteId: rate.remoteId,
            carrier: rate.carrier,
            service: rate.service,
            amountMinor: rate.amountMinor,
            currency: rate.currency,
            deliveryDays: rate.deliveryDays,
            estDeliveryDate: rate.estDeliveryDate,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/shipments/{id}/purchase — buy the label, copy it to R2, record postage + fee
  app.openapi(
    { ...purchaseRoute, middleware: chokepointMiddleware(chokepoint, purchaseRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const id = c.req.valid("param").id as ShipmentId;
      const body = c.req.valid("json");
      const now = () => new Date().toISOString();
      const registry = buildIntegrationRegistry(protectedReadContext(c), runtime);
      const resolved = await registry.resolve<ShippingPort>("shipping", { firmId });
      if (!resolved.ok) return shippingDispatchProblem(c, resolved);

      // Read the draft from THIS firm's database BEFORE spending anything. Two questions are settled
      // here that the carrier cannot settle for us: does this shipment exist for this firm, and is
      // the carrier-side shipment the caller names the one rate-shopping recorded for this draft?
      // Without the second check a caller could aim a purchase at any remote shipment id — buying
      // postage against another draft's addresses, or against a shipment this firm never created.
      const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
        options: string;
        remote_shipment_id: string | null;
        matter_ref: MatterId | null;
      }>();
      const draft = results[0];
      if (draft === undefined) return notFoundProblem(c);
      if (draft.remote_shipment_id !== body.remoteShipmentId) {
        return problemJson(c, {
          type: "validation",
          title: "Shipment does not match the rated quote",
          status: 422,
          detail: "Re-run rate shopping for this shipment and buy one of the returned rates.",
        });
      }

      // Claim the purchase before any money moves. EasyPost has no idempotency-key facility, so a
      // retried or concurrent request would otherwise buy a second label and charge the firm twice;
      // this guarded transition admits exactly one buyer per shipment. A claim that cannot be taken
      // means the shipment is already purchasing, purchased, or refunded.
      const claimed = await claimShipmentPurchaseStatement(
        firm.firmDatabase,
        id,
        idempotency.key,
        now(),
      ).run();
      if (claimed.meta.changes === 0) {
        return problemJson(c, {
          type: "conflict",
          title: "Shipment is not available to purchase",
          status: 409,
          detail:
            "A label purchase for this shipment is already in progress or has completed. Check the shipment's tracking, or refund its label before buying again.",
        });
      }

      // The label bytes go to the firm's own bucket, resolved through the one seam every R2 path
      // here shares (files/firm-bucket.ts).
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      // Insurance was declared when the draft was created; it is bought with the label rather than
      // trusted from the purchase request, so what the firm is told it insured is what is sent.
      const draftOptions = JSON.parse(draft.options) as { insuranceAmountMinor?: number | null };

      // A thrown effect commits no idempotency record, so a retry re-executes the handler — which is
      // exactly why the purchase claim above, not the idempotency record, is the double-buy guard.
      // The R2 key is derived from the firm id and the shipment id, so the put is idempotent across
      // retries too.
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const bought = await resolved.value.port.buyLabel({
            remoteShipmentId: body.remoteShipmentId,
            remoteRateId: body.remoteRateId,
            insuranceAmountMinor: draftOptions.insuranceAmountMinor ?? null,
          });
          if (!bought.ok) throw new ShippingDispatchError(bought);
          const label = bought.value;
          const labelResponse = await fetch(label.labelUrl);
          // The label is now bought and billed, so the bytes must be the real label or nothing: a
          // carrier CDN error page stored here would be served as this shipment's label forever.
          // Throwing keeps the claim (the purchase DID happen), so no later request can buy a second
          // label — the shipment is reconciled by refunding the one that exists.
          if (!labelResponse.ok) {
            throw new ShippingDispatchError({
              ok: false,
              reason: "adapter-error",
              problem: integrationProblem(
                "upstream",
                labelResponse.status,
                "The postage label could not be downloaded",
              ),
            });
          }
          // Firm-scoped key. A label carries the recipient's postal address, so two firms must never
          // be able to name the same object: the firm id in the prefix makes the key space disjoint
          // even where firms share one bucket, and the read path resolves the key from this firm's
          // own database rather than rebuilding it from a request parameter.
          const r2Key = `labels/${firmId}/${id}.pdf`;
          // A shipment may or may not be filed against a matter, and the label follows the shipment:
          // one that names a matter is that matter's, one that does not is the firm's own postage.
          // Both are stamped, so "no matter" is an answer rather than a gap.
          await bucket.put(r2Key, await labelResponse.arrayBuffer(), {
            httpMetadata: { contentType: label.labelFormat },
            customMetadata:
              draft.matter_ref === null
                ? firmScopedObjectDimensions("shipping-label")
                : matterScopedObjectDimensions({
                    objectClass: "shipping-label",
                    matterId: draft.matter_ref,
                  }),
          });
          const recorded = await recordPurchase(
            firm.firmDatabase,
            {
              shipmentId: id,
              remoteShipmentId: label.remoteId,
              carrier: label.carrier,
              service: label.service,
              trackingCode: label.trackingCode,
              labelFormat: label.labelFormat,
              r2Key,
              postageCostMinor: label.costMinor,
              serviceFeeMinor: body.serviceFeeMinor,
              currency: label.currency,
            },
            { clock: { now }, actorUserId: userId },
          );
          return {
            write: recorded.effect,
            responseCode: 200,
            responseBody: canonicalJsonStringify({
              id,
              trackingCode: label.trackingCode,
              labelId: recorded.labelId,
            }),
          };
        },
      }).catch((caught: unknown) => {
        if (caught instanceof ShippingDispatchError) return caught;
        throw caught;
      });
      if (result instanceof ShippingDispatchError) {
        // Hand the claim back only when the carrier definitively refused the buy — nothing was
        // charged, so the firm may correct the request and try again. Every other failure is
        // indeterminate (the label may exist and be billed) or happened after the buy succeeded, and
        // the claim stays held so a second attempt cannot spend a second time.
        if (purchaseDefinitelyNotCharged(result.dispatch)) {
          await releaseShipmentPurchaseClaimStatement(
            firm.firmDatabase,
            id,
            idempotency.key,
            now(),
          ).run();
        }
        return shippingDispatchProblem(c, result.dispatch);
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof PurchaseAck>, 200);
    },
  );

  // GET /api/v1/shipments/{id}/label — stream the label PDF from per-firm R2
  app.openapi(
    { ...labelRoute, middleware: chokepointMiddleware(chokepoint, labelRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").id as ShipmentId;
      // Resolve the object key from THIS firm's own database before touching any bytes: the label row
      // is what proves the firm owns the shipment, and its stored r2_key is server-recorded, never
      // rebuilt from the path parameter. A shipment id belonging to another firm finds no row here and
      // is answered 404 — the same absence-not-refusal answer every other cross-firm read gives, so a
      // caller cannot use the status code to learn that the shipment exists somewhere.
      const { results } = await selectShipmentLabelsStatement(firm.firmDatabase, id).all<{
        r2_key: string;
      }>();
      const label = results[0];
      if (label === undefined) return notFoundProblem(c);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const object = await bucket.get(label.r2_key);
      if (object === null) return notFoundProblem(c);
      return new Response(object.body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="label-${id}.pdf"`,
        },
      });
    },
  );

  // POST /api/v1/shipments/{id}/tracking — pull live tracking, cache events, return them
  app.openapi(
    { ...trackingRoute, middleware: chokepointMiddleware(chokepoint, trackingRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const id = c.req.valid("param").id as ShipmentId;
      const now = () => new Date().toISOString();
      const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
        tracking_code: string | null;
      }>();
      const shipmentRow = results[0];
      if (shipmentRow?.tracking_code == null) return notFoundProblem(c);
      const registry = buildIntegrationRegistry(protectedReadContext(c), runtime);
      const resolved = await registry.resolve<ShippingPort>("shipping", { firmId });
      if (!resolved.ok) return shippingDispatchProblem(c, resolved);
      const tracked = await resolved.value.port.getTracking(shipmentRow.tracking_code);
      if (!tracked.ok) return shippingDispatchProblem(c, tracked);
      // Cache each event (INSERT OR IGNORE dedups by remote_id); a single batch.
      const inserts = tracked.value.map((event) =>
        insertTrackingEventStatement(firm.firmDatabase, {
          id: newIdentifier("trackingEvent"),
          shipmentRef: id,
          remoteId: event.remoteId,
          status: event.status,
          occurredAt: event.occurredAt,
          location: event.location,
          message: event.message,
          createdAt: now(),
        }),
      );
      if (inserts.length > 0) {
        await commitEffectBatch(
          firm.firmDatabase,
          { statements: inserts, outboxMessages: [] },
          { now },
        );
      }
      return c.json(
        {
          events: tracked.value.map((event) => ({
            status: event.status,
            occurredAt: event.occurredAt,
            location: event.location,
            message: event.message,
          })),
        },
        200,
      );
    },
  );

  // POST /api/v1/shipments/{id}/refund — void/refund the label
  app.openapi(
    { ...refundRoute, middleware: chokepointMiddleware(chokepoint, refundRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const id = c.req.valid("param").id as ShipmentId;
      const now = () => new Date().toISOString();
      const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
        remote_shipment_id: string | null;
      }>();
      const remote = results[0]?.remote_shipment_id;
      if (remote == null) return notFoundProblem(c);
      const registry = buildIntegrationRegistry(protectedReadContext(c), runtime);
      const resolved = await registry.resolve<ShippingPort>("shipping", { firmId });
      if (!resolved.ok) return shippingDispatchProblem(c, resolved);
      const refunded = await resolved.value.port.refundLabel(remote);
      if (!refunded.ok) return shippingDispatchProblem(c, refunded);
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const recorded = await recordRefund(firm.firmDatabase, id, {
            clock: { now },
            actorUserId: userId,
          });
          return {
            write: recorded.effect,
            responseCode: 200,
            responseBody: canonicalJsonStringify({ id, status: refunded.value.status }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RefundAck>, 200);
    },
  );
}

// Whether a failed buy is one the carrier refused outright, with certainty that no postage was
// purchased and nothing was billed. `auth`, `validation`, and `rate_limit` are all rejections the
// provider made before doing any work; `not-connected`, `capability-unsupported` and
// `credential-store-not-implemented` never reached it at all — the last of those cannot even
// resolve a port, so the claim is always handed back and the draft stays buyable. `upstream` (a provider 5xx) and `network` (no answer at all) are the indeterminate
// ones — the purchase may well have succeeded on the far side — and must be treated as spent.
function purchaseDefinitelyNotCharged(
  dispatch: Extract<Dispatch<unknown>, { ok: false }>,
): boolean {
  if (dispatch.reason !== "adapter-error") return true;
  const category = dispatch.problem?.category;
  return category === "auth" || category === "validation" || category === "rate_limit";
}

// Carries a non-ok Dispatch out of the idempotent-effect callback so the route maps it to a problem.
class ShippingDispatchError extends Error {
  constructor(public readonly dispatch: Extract<Dispatch<unknown>, { ok: false }>) {
    super("shipping dispatch error");
  }
}

// The integration framework can report that a deployment has no credential store at all. This worker
// always builds one (plugins/credential-store.ts), so the outcome is not reachable from here — but it
// is a member of the Dispatch union the framework returns, and a mapping that silently fell through
// to a 500 would turn a stated condition into an Error ID. Answered by name: nobody in the firm can
// act on it, and the "connect your account" wording next door would send a member at a door that is
// not the shut one. Nothing is charged and nothing is written.
function credentialStoreUnavailableProblem(c: Context): ProblemResponse<501> {
  return problemJson(c, {
    type: "not-implemented",
    title: "Postage is unavailable in this deployment",
    status: 501,
    detail:
      "This deployment cannot read stored integration credentials, so no carrier account can be connected and no label can be rated or bought. Drafting a shipment still works, and nothing has been charged.",
  });
}

// Maps a non-ok shipping Dispatch onto the worker's problem taxonomy. not-connected → 409 (the firm
// must connect/reconnect its account); credential-store-not-implemented → 501 (the deployment has no
// credential store); credential-forbidden → 403 (this member may not decrypt it);
// capability-unsupported → 422; an adapter-error maps by its category — a transient
// provider failure (auth/upstream/network) is a 502 the firm did not cause, rate_limit is 429, and a
// provider validation rejection is 422.
function shippingDispatchProblem(
  c: Context,
  dispatch: Extract<Dispatch<unknown>, { ok: false }>,
):
  | ProblemResponse<403>
  | ProblemResponse<409>
  | ProblemResponse<422>
  | ProblemResponse<429>
  | ProblemResponse<501>
  | ProblemResponse<502> {
  if (dispatch.reason === "credential-store-not-implemented") {
    return credentialStoreUnavailableProblem(c);
  }
  // The firm HAS a postage account; this member may not have its credential decrypted. Said as a
  // permission answer rather than "not connected", which would send them — or the administrator they
  // ask — looking for a connection fault that does not exist. The remedy is a grant.
  if (dispatch.reason === "credential-forbidden") {
    return problemJson(c, {
      type: "permission-denied",
      title: "Forbidden",
      status: 403,
      detail:
        "Your role may create shipments but may not use the firm's stored postage credential. An administrator can grant integrations:useConnection.",
      requestAccess: true,
    });
  }
  if (dispatch.reason === "not-connected") {
    return problemJson(c, {
      type: "conflict",
      title: "Postage account not connected",
      status: 409,
      detail: "Connect the firm's EasyPost account before shipping.",
    });
  }
  if (dispatch.reason === "capability-unsupported") {
    return problemJson(c, {
      type: "validation",
      title: "Unsupported shipping operation",
      status: 422,
      detail: "The postage provider does not support this operation.",
    });
  }
  const category = dispatch.problem?.category;
  if (category === "rate_limit") {
    return problemJson(c, {
      type: "rate-limited",
      title: "Postage provider rate limit",
      status: 429,
    });
  }
  if (category === "validation") {
    return problemJson(c, {
      type: "validation",
      title: "The postage provider rejected the request",
      status: 422,
    });
  }
  return problemJson(c, {
    type: "conflict",
    title: "The postage provider is unavailable",
    status: 502,
  });
}

function notFoundProblem(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "No such shipment in this firm.",
  });
}
