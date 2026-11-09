import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveBundleProgress } from "../../../downloads/bundle-progress.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { isWebSocketUpgrade, subscribeRequest } from "../../../progress/job-progress-sockets.ts";

// The bulk-download job's two status surfaces, side by side because they must always agree.
//
// The POLL endpoint is the one a client that received a 202 from POST /downloads/zip asks repeatedly.
// The SUBSCRIBE endpoint upgrades to a WebSocket the coordinator pushes each transition down, so a
// client learns a build finished at the moment it finished instead of on its next poll. Both resolve
// the job through the same function (downloads/bundle-progress.ts) and hand back the same object, so
// polling is a complete fallback rather than a second, drifting implementation — which is also what
// keeps the surface honest for a client that cannot hold a socket open.
//
// A building/failed job carries no URL; a ready job mints a fresh short-TTL signed GET each time it
// is reported (the URL is never stored). Both endpoints address the coordinator DO by
// firmId:manifestHash with the firm id taken from the SESSION, never the path, so one firm can never
// reach another firm's job by guessing a hash — and both carry the same files:organize capability as
// the download route that created it.

const bundleStatusMeta: RouteMeta = {
  operationId: "downloads.bundleStatus",
  surface: "app",
  authenticated: true,
  permission: "files:organize",
  // files:* capabilities govern matter-rooted file objects, so the resource is "matter" (the same
  // binding the download route declares) — even though the job itself is addressed per firm.
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const BundleStatusResponse = z
  .object({
    status: z.string(),
    // The plain client-zip lane yields a single artifact, signed as `url`. The optioned container
    // lane yields one or more volumes (one for a single-file bundle, several for a 7z split), each
    // signed into `urls`. Exactly one of the two is present on a ready job.
    url: z.string().optional(),
    urls: z.array(z.string()).optional(),
  })
  .openapi("BundleStatus");

const bundleStatusRoute = defineOpenAPIRoute(bundleStatusMeta, {
  method: "get",
  path: "/api/v1/downloads/bundles/{manifestHash}",
  description:
    "Reports the state of an async bulk-download build (building, ready, or failed). A ready job " +
    "carries a freshly minted, short-lived signed URL to the built ZIP artifact.",
  request: { params: z.object({ manifestHash: z.string().min(1) }) },
  responses: {
    200: {
      description: "The job's current state, with a signed URL when ready",
      content: { "application/json": { schema: BundleStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:organize",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const bundleEventsMeta: RouteMeta = {
  operationId: "downloads.bundleEvents",
  surface: "app",
  authenticated: true,
  permission: "files:organize",
  // Same binding as the poll endpoint: a files:* capability governs matter-rooted file objects.
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const bundleEventsRoute = defineOpenAPIRoute(bundleEventsMeta, {
  method: "get",
  path: "/api/v1/downloads/bundles/{manifestHash}/events",
  description:
    "Subscribes to an async bulk-download build over a WebSocket. The server sends the job's " +
    "current state on connect and again on every transition; each frame is " +
    '{ "type": "state", "protocolVersion": 1, "state": { … } } where state is the same object the ' +
    "poll endpoint returns, so a ready job carries a freshly minted, short-lived signed URL. The " +
    'client may send { "type": "resync" } to be re-sent the current state and { "type": "ping" } ' +
    "for a keepalive. A settled job is pushed once and the socket then closes. Requires an Upgrade: " +
    "websocket request; the poll endpoint is the equivalent answer for a client that cannot upgrade.",
  request: { params: z.object({ manifestHash: z.string().min(1) }) },
  responses: {
    101: { description: "The subscription is open; job state follows as WebSocket frames" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:organize",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    426: {
      description: "The request did not ask to upgrade to a WebSocket",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type BundleStatusApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerBundleStatusRoute(app: BundleStatusApp, chokepoint: Chokepoint): void {
  // The poll endpoint.
  app.openapi(
    { ...bundleStatusRoute, middleware: chokepointMiddleware(chokepoint, bundleStatusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const firmBucket = resolveFirmBucket(c.env, firm.bucketName);
      const { manifestHash } = c.req.valid("param");

      const coordinator = c.env.BUNDLE_COORDINATOR.get(
        c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${manifestHash}`),
      );
      const progress = await resolveBundleProgress(c.env, firmBucket, await coordinator.status());
      return c.json(progress, 200);
    },
  );

  // The subscribe endpoint. The upgrade traverses the chokepoint like any other route — the session
  // is resolved, the capability checked, and the firm id that addresses the coordinator comes from
  // that session — and only then is the request handed to the object, which owns the 101. The request
  // forwarded inward is built here from server-derived values (the firm's resolved bucket), so
  // nothing the caller sent can influence which bucket a pushed signed URL is minted against.
  app.openapi(
    { ...bundleEventsRoute, middleware: chokepointMiddleware(chokepoint, bundleEventsRoute) },
    async (c) => {
      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail:
            "This endpoint serves WebSocket subscriptions. Send Upgrade: websocket, or poll " +
            "/api/v1/downloads/bundles/{manifestHash} instead.",
        });
      }
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const bucketName = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const { manifestHash } = c.req.valid("param");

      const coordinator = c.env.BUNDLE_COORDINATOR.get(
        c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${manifestHash}`),
      );
      return coordinator.fetch(subscribeRequest(bucketName));
    },
  );
}
