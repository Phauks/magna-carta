import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertConnectionStatement } from "@magna-carta/data-access/integration-connection-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  insertTrackingEventStatement,
  selectShipmentLabelsStatement,
  selectShipmentStatement,
} from "@magna-carta/data-access/shipment-statements";
import {
  createShipmentDraft,
  recordPurchase,
  recordRefund,
} from "@magna-carta/data-access/shipment-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterId, ShipmentId } from "@magna-carta/identifiers/types";
import type { Dispatch } from "@magna-carta/integrations/dispatch";
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
import type { PluginRuntime } from "../plugins/runtime.ts";

// Shipping & postage: connect the firm's EasyPost postage account, then create/rate/buy/track/refund
// shipments. The API key is stored as a firm secret (never logged); the live carrier calls run
// through the resolved ShippingPort. Every route requires shipping:manage. The PluginRuntime is
// injected so production swaps the real firm_secret store and tests inject a fake EasyPost.

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
  insuranceAmountMinor: z.number().int().nullable().optional(),
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
  },
});

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
      const secrets = runtime.secretStoreForFirm(firm.firmDatabase);
      const descriptor = createEasyPostAdapter({ http: runtime.httpClient }).descriptor;

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
      const registry = buildIntegrationRegistry(firm.firmDatabase, runtime);
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
      const registry = buildIntegrationRegistry(firm.firmDatabase, runtime);
      const resolved = await registry.resolve<ShippingPort>("shipping", { firmId });
      if (!resolved.ok) return shippingDispatchProblem(c, resolved);

      // The label bytes go to the firm's own bucket, resolved through the one seam every R2 path
      // here shares (files/firm-bucket.ts).
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);

      // The chokepoint idempotency key doubles as the EasyPost Idempotency-Key. A thrown effect
      // commits no idempotency record (runIdempotentEffect re-executes on retry), so that header is
      // what prevents a double-buy: EasyPost returns the same label for the same key. The R2 key is
      // derived from the firm id and the shipment id, so the put is idempotent across retries too.
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const bought = await resolved.value.port.buyLabel({
            remoteShipmentId: body.remoteShipmentId,
            remoteRateId: body.remoteRateId,
            idempotencyKey: idempotency.key,
          });
          if (!bought.ok) throw new ShippingDispatchError(bought);
          const label = bought.value;
          const labelResponse = await fetch(label.labelUrl);
          // Firm-scoped key. A label carries the recipient's postal address, so two firms must never
          // be able to name the same object: the firm id in the prefix makes the key space disjoint
          // even where firms share one bucket, and the read path resolves the key from this firm's
          // own database rather than rebuilding it from a request parameter.
          const r2Key = `labels/${firmId}/${id}.pdf`;
          await bucket.put(r2Key, await labelResponse.arrayBuffer(), {
            httpMetadata: { contentType: label.labelFormat },
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
      const registry = buildIntegrationRegistry(firm.firmDatabase, runtime);
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
      const registry = buildIntegrationRegistry(firm.firmDatabase, runtime);
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

// Carries a non-ok Dispatch out of the idempotent-effect callback so the route maps it to a problem.
class ShippingDispatchError extends Error {
  constructor(public readonly dispatch: Extract<Dispatch<unknown>, { ok: false }>) {
    super("shipping dispatch error");
  }
}

// Maps a non-ok shipping Dispatch onto the worker's problem taxonomy. not-connected → 409 (the firm
// must connect/reconnect its account); capability-unsupported → 422; an adapter-error maps by its
// category — a transient provider failure (auth/upstream/network) is a 502 the firm did not cause,
// rate_limit is 429, and a provider validation rejection is 422.
function shippingDispatchProblem(
  c: Context,
  dispatch: Extract<Dispatch<unknown>, { ok: false }>,
): ProblemResponse<409> | ProblemResponse<422> | ProblemResponse<429> | ProblemResponse<502> {
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
