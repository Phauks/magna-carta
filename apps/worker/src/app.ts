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
import { noindexResponseMiddleware } from "./crawler-directives.ts";
import { defaultHook } from "./contracts/problem.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { createCloudflareEmailAdapter, type CloudflareEmailBinding } from "./email-cloudflare.ts";
import { createLoggingEmailAdapter, type SendEmail } from "./email-port.ts";
import { registerBundleStatusRoute } from "./routes/bundle-status.ts";
import { registerConversionRoutes } from "./routes/conversions.ts";
import { registerCustomFieldsRoutes } from "./routes/custom-fields.ts";
import { registerCostsRoutes } from "./routes/costs.ts";
import { registerTimeEntriesRoutes } from "./routes/time-entries.ts";
import { registerTimerRoutes } from "./routes/timer.ts";
import { registerRateCardsRoutes } from "./routes/rate-cards.ts";
import { registerUtbmsCodesRoutes } from "./routes/utbms-codes.ts";
import { registerNonBillableCategoriesRoutes } from "./routes/non-billable-categories.ts";
import { registerNarrativeTemplatesRoutes } from "./routes/narrative-templates.ts";
import { registerMyDayRoutes } from "./routes/my-day.ts";
import { registerDirectoryRoutes } from "./routes/directory.ts";
import { registerDocumentTypesRoutes } from "./routes/document-types.ts";
import { registerDownloadsRoutes } from "./routes/downloads.ts";
import { registerDocumentCheckoutRoutes } from "./editing/checkout-routes.ts";
import { registerDocumentEditingRoutes } from "./editing/edit-session-route.ts";
import { registerWopiHostRoutes } from "./editing/wopi-host.ts";
import { registerFilesRoutes } from "./routes/files.ts";
import { registerScanDiagnoseRoute } from "./routes/scan-diagnose.ts";
import { registerScanMatterRoute } from "./routes/scan-matter.ts";
import { registerScanPolicyRoutes } from "./routes/scan-policy.ts";
import { registerFirmsRoute } from "./routes/firms.ts";
import { registerPlatformReleaseChannelRoute } from "./routes/platform-release-channel.ts";
import { registerFoldersRoutes } from "./routes/folders.ts";
import { registerIncidentsRoute } from "./routes/incidents.ts";
import { registerLocationsRoutes } from "./routes/locations.ts";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import { workerPlugins } from "./plugins/registry.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";
import { firmSecretStoreNotYetAvailable } from "./plugins/secret-store.ts";
import { registerMatterTypesRoutes } from "./routes/matter-types.ts";
import { registerMattersRoutes } from "./routes/matters.ts";
import { registerFirmUsageRoute } from "./routes/firm-usage.ts";
import { registerWhoisRoute, type WhoisRouteDeps } from "./routes/whois.ts";
import { registerSafeBrowseRoute, type SafeBrowseRouteDeps } from "./routes/safe-browse.ts";
import { registerFileIntegrityRoutes } from "./routes/file-integrity.ts";
import { registerFileTypeRoutes } from "./routes/file-type.ts";
import { registerFileRepairRoutes } from "./routes/file-repair.ts";
import { registerAiDetectionRoutes } from "./routes/ai-detection.ts";
import { registerMetadataRoutes } from "./routes/metadata.ts";
import { registerSupportGrantsRoutes } from "./routes/support-grants.ts";
import { registerSupportSessionsRoute } from "./routes/support-sessions.ts";
import { registerSupportDiagnosticsRoute } from "./routes/support-diagnostics.ts";
import { registerDevWebToolsDemoRoute } from "./routes/dev-web-tools-demo.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerMembersRoute } from "./routes/members.ts";
import { registerReleaseChannelRoute } from "./routes/release-channel.ts";
import { registerNumberingRoutes } from "./routes/numbering.ts";
import { registerUploadsRoutes } from "./routes/uploads.ts";
import { registerPreviewServeRoute } from "./files/preview-serve.ts";
import { telemetryErrorHandler, telemetryMiddleware } from "./telemetry-middleware.ts";
import { createUsageConsentResolver } from "./usage/consent.ts";
import { usageReachedMiddleware } from "./usage/reached-middleware.ts";

// The Worker's runtime bindings, declared once here (the no-barrel single home for the app's env shape).
// worker-env.d.ts mirrors this into the ambient `Cloudflare.Env` the vitest-pool-workers harness types `env` as.
export type Bindings = {
  ASSETS: Fetcher;
  DB_CONTROL: D1Database;
  R2: R2Bucket;
  QUEUE: Queue;
  // The per-document editing session coordinator (one Durable Object per open file), SQLite-backed so
  // its session state survives the editing container sleeping. Unparameterized to avoid a circular
  // import with the DocumentSession class (which imports this Bindings type).
  DOCUMENT_SESSION: DurableObjectNamespace;
  // The files-ingest queue binding for the interactive lane (files/ prefix).
  FILES_INGEST?: Queue;
  // The files-ingest-bulk queue binding for the bulk lane (bulk/ prefix, lower concurrency).
  FILES_INGEST_BULK?: Queue;
  // The async bulk-download coordinator (the codebase's first Durable Object): keyed
  // firmId:manifestHash, it single-flights one ZIP build per content-addressed selection.
  BUNDLE_COORDINATOR: DurableObjectNamespace<
    import("./downloads/bundle-coordinator.ts").BundleBuildCoordinator
  >;
  // The per-firm SQLite-backed database DO: one instance per firm, addressed idFromName(firmId),
  // self-migrating on wake. All per-firm data-plane SQL routes through here.
  FIRM_DATABASE: DurableObjectNamespace<
    import("./firm-database/firm-database-object.ts").FirmDatabase
  >;
  // The bundle-build queue the coordinator enqueues onto; its consumer streams R2 -> client-zip -> R2.
  BUNDLE_BUILD: Queue<import("./downloads/bundle-types.ts").BundleBuildMessage>;
  // The malware-scan Worker service binding. Dispatches file content to the scan worker for a
  // verdict. Optional here so the pool can start without a running scan service; resolveScanPort
  // falls back to the no-engine adapter when absent or when the bound service returns unscanned.
  SCAN_SERVICE?: Fetcher;
  // The dedicated bundle-build worker (magna-carta-bundle), reached over this service binding.
  // Optional here so the pool can start without a running bundle worker; the bundle coordinator
  // only calls it at build time (POST /build) and surfaces any absence as a build failure.
  BUNDLE_SERVICE?: Fetcher;
  // The off-hot-path AI inference dispatch queue: an inference request is enqueued here and the consumer
  // (src/inference/inference-consumer.ts) runs env.AI.run, so a single firm cannot starve the shared
  // gateway cap synchronously on the request path. Distinct from QUEUE (jobs) and FILES_INGEST.
  INFERENCE: Queue;
  // The conversion-job coordinator: keyed firmId:jobId, single-flights one conversion per job.
  CONVERSION_JOB: DurableObjectNamespace<
    import("./conversions/conversion-coordinator.ts").ConversionJob
  >;
  // The server-conversion queue the coordinator enqueues onto; the consumer runs the ConversionPort adapter.
  CONVERSION: Queue<import("./conversions/conversion-types.ts").ConversionMessage>;
  // The dedicated conversion engine worker (magna-carta-convert), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, resolveEnginePort returns the deferred port (engine-not-implemented).
  CONVERT?: Fetcher;
  // The dedicated file-repair engine worker (magna-carta-file-repair), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, the file-repair routes return 503 (the same posture the file-type and bundle routes take).
  FILE_REPAIR_SERVICE?: Fetcher;
  // The authenticated Workers AI binding — the only path inference reaches the gateway through (no raw
  // gateway token in any firm-reachable config). Pre-authenticated within the account.
  AI: Ai;
  // Better Auth's signing/encryption secret. Local dev + tests load it from .dev.vars;
  // production sets it with `wrangler secret put AUTH_SECRET`.
  AUTH_SECRET: string;
  // The cookieless files host (e.g. files.magnacarta.esq). Optional: does not exist until the apex
  // domain attaches; while unset the preview grant degrades to download-only. The cookieless serve
  // route only ever answers when the request hostname equals this value. A public hostname, not a
  // secret — bound via wrangler.jsonc vars, never .dev.vars.
  FILES_ORIGIN?: string;
  // The POST /api/v1/firms guard secret (constant-time-compared against X-Platform-Admin-Key — a
  // stand-in seam until a real platform-admin principal model exists). Local dev + tests load the
  // placeholder from .dev.vars; production sets it with `wrangler secret put PLATFORM_ADMIN_KEY`.
  PLATFORM_ADMIN_KEY: string;
  // The root key-encryption key (base64, 32 bytes) at the top of the encryption key hierarchy —
  // it wraps the per-firm data keys, so no plaintext data key is ever stored. Local dev + tests
  // load the placeholder from .dev.vars; production sets it with `wrangler secret put ROOT_KEK`.
  ROOT_KEK: string;
  // Cloudflare REST FirmResourceProvider credentials — DEPLOY-TIME secrets only (`wrangler
  // secret put`), deliberately absent from .dev.vars: locally the dev pool-claiming adapter runs
  // instead, selected by these being unset (see routes/firms.ts resourceProviderForEnv).
  CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER?: string;
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
  // The dedicated cookieless content domain (a separate registrable domain from the app) that serves all
  // browser-served untrusted bytes: the editor at `<documentKey>.<USERCONTENT_DOMAIN>` and file
  // previews/downloads at `files.<USERCONTENT_DOMAIN>`. Optional and rarely set — the production value is
  // the code default (magnacartausercontent.com), so only local dev overrides it (e.g. to edit.localhost).
  USERCONTENT_DOMAIN?: string;
  // The per-timekeeper live-timer Durable Object namespace (the first DO). The timer routes proxy to
  // one instance per `${firmId}:${userId}`; the stop-commit reads the DO's final state and writes the
  // time entry through the data-access chokepoint. The DO holds no business rows.
  DURABLE_TIMER: DurableObjectNamespace<
    import("./timer/live-timer-durable-object.ts").LiveTimerDurableObject
  >;
  // Browser Rendering Workers binding — used by POST /api/v1/safe-browse to render a URL in an
  // isolated remote browser. Optional here so Miniflare (which has no local browser emulation) can
  // boot and run the full test suite without touching this binding; the route ALWAYS receives an
  // injected renderer dep in tests, so c.env.BROWSER is never accessed during testing.
  BROWSER?: unknown;
  // Throwaway dev-only switch for the barebones /__dev/web-tools demo page (WHOIS + Safe Website
  // Viewer). Unset in production, so the demo route answers 404 there; set DEV_DEMO_TOOLS=1 in
  // .dev.vars to view it locally. Not part of any contract; remove the demo route when no longer needed.
  DEV_DEMO_TOOLS?: string;
  // Cloudflare Flagship feature-flag binding. Optional: absent in local dev, tests, and deployments
  // before the Flagship provider is wired. The resolver (src/flags/flag-evaluator.ts) falls back to
  // defaultOffEvaluator when this is undefined, so every flag returns its stable default safely.
  FLAGS?: import("@magna-carta/feature-flags").FlagshipBinding;
  // The platform-managed AI-text-detection provider key + base URL. Optional: absent in tests and
  // until the deploy-time secret is set, in which case the detection route reports detection
  // unavailable. A platform secret, never a per-firm credential; production sets it with
  // `wrangler secret put PANGRAM_API_KEY`. PANGRAM_BASE_URL is public config (a var, not a secret) and
  // is an OPTIONAL override only: PANGRAM_MODE alone selects the correct default host (async-task ->
  // the external-api host, sync -> the /v3 host); set PANGRAM_BASE_URL only to point at something else.
  PANGRAM_API_KEY?: string;
  PANGRAM_BASE_URL?: string;
  // Which Pangram surface the platform key is provisioned for: "async-task" (the external-api that
  // returns a task to poll) or "sync". Optional; defaults to "async-task". A public config value, not
  // a secret — bound via wrangler vars.
  PANGRAM_MODE?: "async-task" | "sync";
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
  // Overrides the plugin runtime for tests (a fake EasyPost http client + an in-memory secret store).
  pluginRuntime?: Partial<PluginRuntime>;
  // Overrides the WHOIS route dependencies for tests (a fake RDAP http client + a fake socket).
  // Production defaults: fetchHttpClient() for RDAP, the cloudflare:sockets connect() adapter for
  // port-43 WHOIS, and no resolver (DNS-rebinding protection is deferred until a DoH adapter is wired).
  whoisDeps?: Partial<WhoisRouteDeps>;
  // Overrides the safe-browse route dependencies for tests (a fake renderer + a fake probe).
  // Production defaults: createBrowserRenderer(c.env.BROWSER) + createFetchRedirectProbe().
  // Tests ALWAYS supply safeBrowseDeps so c.env.BROWSER is never accessed in the test pool.
  safeBrowseDeps?: SafeBrowseRouteDeps;
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
  // resolution (control-plane lookup + the firmId-addressed FirmDatabase DO + member-active
  // check), permission
  // loading, the platform-scoped/firm-scoped idempotency gate, and a per-isolate in-memory rate
  // limiter (one limiter per app instance, never per request). This is THE single
  // tenancy/authn/RBAC/idempotency/rate-limit enforcement point every /api/v1 route traverses.
  const rateLimiter = createInMemoryRateLimiter();
  const ports = createChokepointPorts(authForEnv, rateLimiter);
  const chokepoint = createChokepoint<FirmContext>({
    ...ports,
    idempotency: createChokepointIdempotency(),
  });

  // The cookieless preview serve route: a bare, host-guarded route on the files host, OUTSIDE the
  // chokepoint (no session on files.*), under /api/ so it reaches the Worker (run_worker_first).
  // Registered FIRST so its files-host catch-all seals the cookieless origin BEFORE any other route
  // (health, Better Auth, /api/v1, ASSETS) can answer on files.* — the seal only holds if nothing is
  // registered ahead of it. On the app origin the catch-all falls through (next()), so the routes
  // below are unaffected. A standing fitness test asserts /api/health and /api/auth/* return the bare
  // 404 on the files host, so this ordering seal cannot silently regress as routes are added.
  registerPreviewServeRoute(app);

  // Stamp X-Robots-Tag: noindex on every response BELOW this point. Registered AFTER the cookieless
  // preview route on purpose: Hono middleware only wraps routes registered after it, so the sealed
  // files.* edge (attachment bytes + bare 404s, never an indexable page) keeps its exhaustive,
  // payload-derived header set untouched, while the app origin, API, Better Auth, health, and the SPA
  // shell — every private, firm-scoped surface this Worker serves — are kept out of search indexes.
  app.use("*", noindexResponseMiddleware());

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

  // The WHOIS route: RDAP-first domain/IP registration lookup with a port-43 fallback. All outbound
  // effects go through injected deps so tests substitute fakes without touching global fetch or sockets.
  // The production socket opens a raw TCP connection on port 43 via cloudflare:sockets connect().
  const productionWhoisSocket: WhoisRouteDeps["socket"] = {
    async query(host, request) {
      // Imported lazily: cloudflare:sockets is a Workers-only module, so a top-level import would
      // break Node-based tooling (the emit-openapi script loads this file outside the Worker runtime).
      const { connect } = await import("cloudflare:sockets");
      const socket = connect({ hostname: host, port: 43 });
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(request));
      await writer.close();
      const reader = socket.readable.getReader();
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        // cloudflare:sockets does not auto-close when the readable is exhausted; release the
        // reader lock first so close() can drain and tear down the underlying TCP connection.
        reader.releaseLock();
        await socket.close();
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder().decode(merged);
    },
  };
  const whoisDeps: WhoisRouteDeps = {
    http: options.whoisDeps?.http ?? fetchHttpClient(),
    socket: options.whoisDeps?.socket ?? productionWhoisSocket,
    resolve: options.whoisDeps?.resolve,
  };
  registerWhoisRoute(app, chokepoint, whoisDeps);
  // The safe-browse route: renders a suspect URL in an isolated remote browser and returns a
  // static snapshot. All outbound effects go through injected deps so tests substitute fakes
  // without touching the BROWSER binding. Production: createBrowserRenderer(c.env.BROWSER) +
  // createFetchRedirectProbe() — built lazily in the handler, never at startup.
  registerSafeBrowseRoute(app, chokepoint, options.safeBrowseDeps ?? {});
  registerFileIntegrityRoutes(app, chokepoint);
  registerFileTypeRoutes(app, chokepoint);
  registerFileRepairRoutes(app, chokepoint);
  registerAiDetectionRoutes(app, chokepoint);
  registerMetadataRoutes(app, chokepoint);
  registerMembersRoute(app, chokepoint, authForEnv);
  registerReleaseChannelRoute(app, chokepoint, authForEnv);
  registerFirmsRoute(app, chokepoint, authForEnv);
  registerPlatformReleaseChannelRoute(app, chokepoint);
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
  // Slice 2·2: in-app document editing — the editor-launch route that mints the WOPI access token and
  // returns the editor URL to iframe (the WOPI host callback surface is its own token-guarded route).
  registerDocumentEditingRoutes(app, chokepoint);
  // Slice 2·2: the WOPI host callback surface (/wopi/files/*) — cookieless, access-token-guarded,
  // OUTSIDE the chokepoint (the editor sends no session cookie). The editor's data plane.
  registerWopiHostRoutes(app);
  // Slice 2·2: offline checkout / check-in — take a working copy out and return it through the
  // quarantine ingest, reconciling divergence as a human-reviewed conflicting copy.
  registerDocumentCheckoutRoutes(app, chokepoint);
  // The one-off, matter-less malware-scan diagnostic — stream a file through the engine, get a verdict.
  registerScanDiagnoseRoute(app, chokepoint);
  // "Scan this matter now" — queue a background re-scan of a matter's stale files on the bulk lane.
  registerScanMatterRoute(app, chokepoint);
  // Read and update the firm's malware scan-policy settings (tier, score floor, flagged treatment).
  registerScanPolicyRoutes(app, chokepoint);
  // The async bulk-download poll endpoint — the status side of the download route's 202 hand-off.
  registerBundleStatusRoute(app, chokepoint);
  // Slice 1·3: the directory (persons/organizations, names, sensitive identifiers, edges,
  // categories, search, merge, matter-party link) — composed through the same chokepoint.
  registerDirectoryRoutes(app, chokepoint);
  // Slice 1·4: firm-defined custom fields (definitions, picklist options, temporal values, the
  // non-destructive Convert, and the compliance purge seam) — composed through the same chokepoint.
  registerCustomFieldsRoutes(app, chokepoint);
  // Costs / disbursements — the cost-entry WIP store, composed through the same chokepoint.
  registerCostsRoutes(app, chokepoint);
  // Time tracking — the work-in-progress entry surface, composed through the same chokepoint.
  registerTimeEntriesRoutes(app, chokepoint);
  // Timer routes: the per-timekeeper live timer (DO proxy) and the idempotent stop-commit.
  registerTimerRoutes(app, chokepoint);
  // Rate card management: create cards, append effective-dated rates, re-rate unbilled drafts.
  registerRateCardsRoutes(app, chokepoint);
  // UTBMS code catalog: list and toggle enable/disable on the seeded ABA set.
  registerUtbmsCodesRoutes(app, chokepoint);
  // Non-billable category management: create, rename, soft-archive.
  registerNonBillableCategoriesRoutes(app, chokepoint);
  // Narrative template management: create, list, archive, and read recent narratives.
  registerNarrativeTemplatesRoutes(app, chokepoint);
  // My Day: daily headline totals (billable, non-billable, target, shortfall).
  registerMyDayRoutes(app, chokepoint);
  // The server-conversion surface: presign an upload slot, submit a job, and poll its state.
  // Each route traverses the same chokepoint under the tools:fileConverter permission.
  registerConversionRoutes(app, chokepoint);
  // Support access — firm members request time-boxed help-desk access; the list gives all members
  // the transparency surface (who has or had access to their firm). Co-sign and revoke land in the
  // next task.
  registerSupportGrantsRoutes(app, chokepoint);
  // Support sessions — a platform-staff principal redeems an active grant for a support-session
  // token. Public surface (platform-admin-key guard); the chokepoint applies the idempotency and
  // rate-limit gates.
  registerSupportSessionsRoute(app, chokepoint);
  // Support diagnostics — the read-only firm system-state overview gated on diagnostics:overview,
  // a permission never seeded to any firm role. Only a diagnostic support session carries it.
  registerSupportDiagnosticsRoute(app, chokepoint);

  // The plugin runtime: production defaults (a fetch-backed http client; the firm_secret store seam
  // that throws until the marketplace wires the live credential read), overridable in tests.
  const pluginRuntime: PluginRuntime = {
    httpClient: options.pluginRuntime?.httpClient ?? fetchHttpClient(),
    secretStoreForFirm: options.pluginRuntime?.secretStoreForFirm ?? firmSecretStoreNotYetAvailable,
  };
  // Plugins mount from the registry — the core names no plugin. Each registers through the chokepoint.
  for (const plugin of workerPlugins) plugin.registerRoutes?.(app, chokepoint, pluginRuntime);

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

  // Throwaway dev-only demo page for the Websites & Domains tools (gated on DEV_DEMO_TOOLS; 404 in
  // production). A bare route, so it never enters the OpenAPI contract. Remove with the demo file.
  registerDevWebToolsDemoRoute(app);

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
export function emitOpenAPIDocument(
  app: ReturnType<typeof createApp>,
): ReturnType<typeof app.getOpenAPI31Document> {
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
export function buildOpenAPIDocument(): ReturnType<typeof emitOpenAPIDocument> {
  return emitOpenAPIDocument(createApp());
}

// Canonical serialization — pretty-printed (two-space), single trailing newline. The one byte-exact
// definition the emitter writes and the sanity test compares against, so the committed snapshot and
// a fresh emission can be diffed byte-for-byte (the local mirror of the CI code-as-contract gate).
export function serializeOpenAPIDocument(): string {
  return `${JSON.stringify(buildOpenAPIDocument(), null, 2)}\n`;
}
