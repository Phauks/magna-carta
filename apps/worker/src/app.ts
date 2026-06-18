import { OpenAPIHono } from "@hono/zod-openapi";
import type { Logger } from "@magna-carta/telemetry/logger";
import {
  createWorkersLogger,
  type AnalyticsEngineDataset,
} from "@magna-carta/telemetry/workers-logger";
import { createAuth } from "./auth.ts";
import { createChokepoint } from "./chokepoint/chokepoint.ts";
import { createChokepointIdempotency } from "./chokepoint/idempotency-port.ts";
import { createChokepointPorts, type AppVariables, type FirmContext } from "./chokepoint/ports.ts";
import { createInMemoryRateLimiter } from "./chokepoint/rate-limiter.ts";
import { defaultHook } from "./contracts/problem.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { createCloudflareEmailAdapter, type CloudflareEmailBinding } from "./email-cloudflare.ts";
import { createLoggingEmailAdapter, type SendEmail } from "./email-port.ts";
import { registerDocumentTypesRoutes } from "./routes/document-types.ts";
import { registerDownloadsRoutes } from "./routes/downloads.ts";
import { registerFilesRoutes } from "./routes/files.ts";
import { registerFirmsRoute } from "./routes/firms.ts";
import { registerFoldersRoutes } from "./routes/folders.ts";
import { registerIncidentsRoute } from "./routes/incidents.ts";
import { registerLocationsRoutes } from "./routes/locations.ts";
import { registerMatterTypesRoutes } from "./routes/matter-types.ts";
import { registerMattersRoutes } from "./routes/matters.ts";
import { registerFirmUsageRoute } from "./routes/firm-usage.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerMembersRoute } from "./routes/members.ts";
import { registerNumberingRoutes } from "./routes/numbering.ts";
import { registerUploadsRoutes } from "./routes/uploads.ts";
import { telemetryErrorHandler, telemetryMiddleware } from "./telemetry-middleware.ts";
import { createUsageConsentResolver } from "./usage/consent.ts";
import { usageReachedMiddleware } from "./usage/reached-middleware.ts";

// The Worker's runtime bindings, declared once here (the no-barrel single home for the app's env shape).
// worker-env.d.ts mirrors this into the ambient `Cloudflare.Env` the vitest-pool-workers harness types `env` as.
export type Bindings = {
  ASSETS: Fetcher;
  DB_CONTROL: D1Database;
  // The dev firm-database pool — pre-declared because Miniflare cannot create D1 at runtime;
  // resolved from a firm's database_identifier by firm-binding-resolver.ts.
  DB_FIRM_POOL_1: D1Database;
  DB_FIRM_POOL_2: D1Database;
  R2: R2Bucket;
  QUEUE: Queue;
  // Better Auth's signing/encryption secret. Local dev + tests load it from .dev.vars;
  // production sets it with `wrangler secret put AUTH_SECRET`.
  AUTH_SECRET: string;
  // The POST /api/v1/firms guard secret (constant-time-compared against X-Platform-Admin-Key — a
  // stand-in seam until a real platform-admin principal model exists). Local dev + tests load the
  // placeholder from .dev.vars; production sets it with `wrangler secret put PLATFORM_ADMIN_KEY`.
  PLATFORM_ADMIN_KEY: string;
  // Cloudflare REST FirmResourceProvider credentials — DEPLOY-TIME secrets only (`wrangler
  // secret put`), deliberately absent from .dev.vars: locally the dev pool-claiming adapter runs
  // instead, selected by these being unset (see routes/firms.ts resourceProviderForEnv).
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  // The account-scoped R2 S3 API token the presigner signs upload/download URLs with — the bytes
  // bypass the Worker, so it holds only this signing credential. Production secrets (placeholder
  // values in .dev.vars to satisfy the secrets.required gate).
  // Real presigning ALSO needs CLOUDFLARE_ACCOUNT_ID (the R2 S3 endpoint host), which is absent
  // locally — so local dev and tests fall back to the dev presigner (presigner-wiring.ts) and never
  // call the network.
  R2_S3_ACCESS_KEY_ID?: string;
  R2_S3_SECRET_ACCESS_KEY?: string;
  // The files-ingest queue's Cloudflare UUID — the REST FirmResourceProvider targets it when
  // configuring a firm bucket's object-create notification. A deploy-time fact (absent locally,
  // where the dev adapter runs and Miniflare delivers no R2 notifications).
  FILES_INGEST_QUEUE_ID?: string;
  // "development" enables the dev-only response validator (chokepoint/response-validator.ts);
  // unset in production (wrangler.jsonc declares no var), set locally via .dev.vars.
  ENVIRONMENT?: string;
  // The Analytics Engine dataset the Workers logger mirrors counters to (slice 0·6). Optional: a
  // missing binding (dev/test, or a deployment without it) degrades to console-only logging, never
  // throws (createWorkersLogger handles undefined).
  TELEMETRY?: AnalyticsEngineDataset;
  // The HMAC pepper for pseudonymizing firm and user ids in usage-analytics events. Optional: absent
  // in dev/test (no binding set), which causes emitUsage to fail closed and emit nothing — so the
  // global reached middleware is behaviorally inert in those environments.
  USAGE_ANALYTICS_PEPPER?: string;
  // Cloudflare Email Service. Both optional: the Cloudflare adapter is selected
  // only when the send_email binding AND EMAIL_FROM are present (production); dev/test leave EMAIL_FROM
  // unset and keep the logging adapter, so no real email is sent and no domain onboarding is required.
  SEND_EMAIL?: CloudflareEmailBinding;
  EMAIL_FROM?: string;
};

// One Better Auth instance per worker env: the env object is stable across requests within an
// isolate, so a WeakMap-keyed cache builds the auth context once instead of on every request.
// The dev logging email adapter is wired here for now; slice 0·6 swaps in real transactional
// email behind the same SendEmail port.
const authInstanceByEnv = new WeakMap<Bindings, ReturnType<typeof createAuth>>();

// The outbound-email adapter for an env: the real Cloudflare Email Service when its binding AND
// EMAIL_FROM are both present (production), otherwise the dev logging adapter. EMAIL_FROM is the
// selection key — unset in dev/test (.dev.vars omits it), so tests never touch the real binding and
// no domain onboarding is required to run locally. The Cloudflare adapter logs through the per-env
// Workers logger (email.sent — class + outcome, never body).
function emailAdapterForEnv(env: Bindings): SendEmail {
  if (env.SEND_EMAIL !== undefined && env.EMAIL_FROM !== undefined && env.EMAIL_FROM !== "") {
    return createCloudflareEmailAdapter(env.SEND_EMAIL, env.EMAIL_FROM, defaultLoggerForEnv(env));
  }
  return createLoggingEmailAdapter();
}

function authForEnv(env: Bindings): ReturnType<typeof createAuth> {
  let auth = authInstanceByEnv.get(env);
  if (auth === undefined) {
    auth = createAuth(env, emailAdapterForEnv(env));
    authInstanceByEnv.set(env, auth);
  }
  return auth;
}

// One Workers logger per env (the env object is stable within an isolate), built over the optional
// TELEMETRY Analytics Engine binding. The single production wiring of createWorkersLogger.
const loggerInstanceByEnv = new WeakMap<Bindings, Logger>();
function defaultLoggerForEnv(env: Bindings): Logger {
  let logger = loggerInstanceByEnv.get(env);
  if (logger === undefined) {
    logger = createWorkersLogger(env.TELEMETRY);
    loggerInstanceByEnv.set(env, logger);
  }
  return logger;
}

// createApp options exist for tests (the seam is ours): a memory logger to assert emitted events, an
// injectable clock for deterministic durations, and the telemetry probe routes that exercise the
// error boundary and the route-template behavior. Production (index.ts) calls createApp() with no
// options — the Workers logger, the real clock, no probes.
export interface CreateAppOptions {
  loggerForEnv?: (env: Bindings) => Logger;
  clock?: () => number;
  includeTelemetryProbes?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const loggerForEnv = options.loggerForEnv ?? defaultLoggerForEnv;

  // defaultHook: every Zod request-validation failure becomes the 422 problem with
  // field-level errors[] — installed app-wide so no route re-derives it.
  const app = new OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>({ defaultHook });

  // Telemetry FIRST: before the chokepoint and every route, so it mints the correlation id, stashes
  // the request-scoped logger, and times the request. app.use registered here applies to every route
  // below. The error boundary is the onError handler (Hono's compose routes a thrown handler there,
  // not back up through middleware) — it logs error.captured and returns the 500.
  app.onError(telemetryErrorHandler(options.clock));
  app.use("*", telemetryMiddleware(loggerForEnv, options.clock));

  // Usage reached events: runs on the OUTBOUND pass (after next()), after the chokepoint has
  // populated tenancy. The consent resolver is created once per app instance so its isolate-local
  // TTL cache persists across requests (a per-request resolver would re-query D1 on every request).
  // Without USAGE_ANALYTICS_PEPPER the emitter fails closed and emits nothing — behaviorally inert
  // in dev/test environments where the binding is absent.
  const usageConsentResolver = createUsageConsentResolver();
  app.use(
    "*",
    usageReachedMiddleware({
      pepperFor: (env) => env.USAGE_ANALYTICS_PEPPER,
      consent: usageConsentResolver,
    }),
  );

  // The chokepoint: built once over the REAL ports — session resolution, firm-context
  // resolution (control-plane lookup + firm-binding-resolver + member-active check), permission
  // loading, the platform-scoped/firm-scoped idempotency gate, and a per-isolate in-memory rate
  // limiter (one limiter per app instance, never per request). This is THE single
  // tenancy/authn/RBAC/idempotency/rate-limit enforcement point every /api/v1 route traverses.
  const rateLimiter = createInMemoryRateLimiter();
  const ports = createChokepointPorts(authForEnv, rateLimiter);
  const chokepoint = createChokepoint<FirmContext>({
    ...ports,
    idempotency: createChokepointIdempotency(),
  });

  // Health is platform plumbing: public, unauthenticated, no /api/v1 surface — it still rides the
  // chokepoint (rate-limit only, no session/firm/RBAC) so EVERY declared route is enforced through
  // the one seam, none reachable that skips it.
  registerHealthRoute(app, chokepoint);

  // Better Auth owns everything under its default basePath, /api/auth/* — its router serves
  // only GET and POST. Registered before the catch-all asset fallthrough, OUTSIDE the chokepoint
  // (it is its own authentication surface, not a /api/v1 route).
  app.on(["GET", "POST"], "/api/auth/*", (c) => authForEnv(c.env).handler(c.req.raw));

  // The /api/v1 routes, each composed through the chokepoint (the one enforcement point). The
  // public firms route additionally mounts the platform-admin secret guard as route-specific
  // middleware, run before the chokepoint's idempotency/rate-limit gates (see routes/firms.ts).
  registerMeRoute(app, chokepoint);
  registerFirmUsageRoute(app, chokepoint);
  registerMembersRoute(app, chokepoint, authForEnv);
  registerFirmsRoute(app, chokepoint, authForEnv);
  registerIncidentsRoute(app, chokepoint);
  registerUploadsRoutes(app, chokepoint);
  // Slice 1·1: matters (shell + lifecycle), per-firm matter/document types, Locations, and the
  // numbering-scheme surface — each composed through the same chokepoint.
  registerMattersRoutes(app, chokepoint);
  registerMatterTypesRoutes(app, chokepoint);
  registerDocumentTypesRoutes(app, chokepoint);
  registerLocationsRoutes(app, chokepoint);
  registerNumberingRoutes(app, chokepoint);
  // Slice 1·1: the File Manager's folder/file metadata surface, signed single-file download, and the
  // streaming ZIP64 bulk download — each composed through the same chokepoint.
  registerFoldersRoutes(app, chokepoint);
  registerFilesRoutes(app, chokepoint);
  registerDownloadsRoutes(app, chokepoint);

  // Serve the same document the committed snapshot carries (root tags included), so the live endpoint
  // and the snapshot never diverge. A plain route, so it does not appear in the document itself.
  app.get("/api/openapi.json", (c) => c.json(emitOpenAPIDocument(app)));

  // Test-only probes (never in production: gated on the option, and bare app.get so they never enter
  // the OpenAPI contract). They sit inside the global telemetry middleware but outside the chokepoint
  // and BEFORE the asset fallthrough so they match first. One proves the route-TEMPLATE behavior (a
  // parameterized path logged as its pattern, not the concrete id); one throws to exercise the
  // error boundary (the message carries an email to prove the scrubber backstops error.captured).
  if (options.includeTelemetryProbes) {
    app.get("/api/v1/__telemetry-probe/:probeId", (c) => c.json({ ok: true }));
    app.get("/api/v1/__telemetry-throw", () => {
      throw new Error("telemetry probe boom for leak@example.com");
    });
  }

  // Everything not handled above falls through to the static-asset SPA (Workers Static Assets binding).
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}

// The OpenAPI 3.1 document config — the single home for info/servers/version, consumed both by the
// live /api/openapi.json route (above) and by the offline snapshot emitter (scripts/emit-openapi.mts).
export const openAPIDocumentConfig = {
  openapi: "3.1.0",
  info: {
    title: "Magna Carta API",
    version: "0.0.0",
    description:
      "The Magna Carta legal practice-management API. Every operation is enforced at one " +
      "chokepoint (tenancy → authn → RBAC → idempotency → rate-limit); errors are " +
      "RFC 9457 problem documents.",
    contact: { name: "Magna Carta", url: "https://magnacarta.esq" },
  },
  servers: [
    { url: "https://api.magnacarta.esq/v1", description: "Production API surface" },
    { url: "https://app.magnacarta.esq/api", description: "App same-origin surface" },
  ],
};

// Emits the 3.1 document and declares every operation tag at the document root. Derived from the
// operations, the root tag list can never drift from the routes (registry-first; an operation's tags
// default from its operationId namespace in defineOpenAPIRoute) — it makes the contract self-describing
// (the generated SDK/docs group by tag) and satisfies Spectral's operation-tag-defined. The single
// emit path shared by the committed snapshot and the live /api/openapi.json route, so they never
// diverge. getOpenAPI31Document is pure (no request, no env), so this needs no bindings.
export function emitOpenAPIDocument(app: ReturnType<typeof createApp>) {
  const document = app.getOpenAPI31Document(openAPIDocumentConfig);
  const methods = ["get", "put", "post", "delete", "patch", "options", "head", "trace"] as const;
  const tagNames = new Set<string>();
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (operation?.tags) for (const tag of operation.tags) tagNames.add(tag);
    }
  }
  document.tags = [...tagNames].sort().map((name) => ({ name }));
  return document;
}

// Builds the committed-contract document with no bindings: createApp() registers every route at
// construction time. The emit script loads this through the Vite pipeline; the snapshot sanity test
// calls it in-pool.
export function buildOpenAPIDocument() {
  return emitOpenAPIDocument(createApp());
}

// Canonical serialization — pretty-printed (two-space), single trailing newline. The one byte-exact
// definition the emitter writes and the sanity test compares against, so the committed snapshot and
// a fresh emission can be diffed byte-for-byte (the local mirror of the CI code-as-contract gate).
export function serializeOpenAPIDocument(): string {
  return `${JSON.stringify(buildOpenAPIDocument(), null, 2)}\n`;
}
