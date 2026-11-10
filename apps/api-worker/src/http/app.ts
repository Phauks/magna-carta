import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import type { SealPort } from "@magna-carta/signing/port";
import type { Logger } from "@magna-carta/telemetry/logger";
import { authForEnv } from "../auth-instance.ts";
import type { Bindings } from "../bindings.ts";
import type { SendEmail } from "../email-port.ts";
import { createChokepoint } from "./chokepoint/chokepoint.ts";
import type { HumanVerificationGateOptions } from "./human-verification/human-verification-gate.ts";
import { createChokepointIdempotency } from "./chokepoint/idempotency-port.ts";
import { createChokepointPorts, type AppVariables, type FirmContext } from "./chokepoint/ports.ts";
import { createInMemoryRateLimiter } from "./chokepoint/rate-limiter.ts";
import { noindexResponseMiddleware } from "./crawler-directives.ts";
import { createDomainApp, type DomainDeps } from "./routes/domain-app.ts";
import { DOMAIN_MODULES } from "./routes/manifest.ts";
import { registerHealthRoute } from "./routes/platform/health.ts";
import type { SafeBrowseRouteDeps } from "./routes/tools/safe-browse.ts";
import type { WhoisRouteDeps } from "./routes/tools/whois.ts";
import { registerWopiHostRoutes } from "../editing/wopi-host.ts";
import { registerSplitObjectHostRoutes } from "../search/split-object-host.ts";
import { registerMeetingSinkRoute } from "../meetings/meeting-sink-route.ts";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import { workerPlugins } from "../plugins/registry.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";
import { integrationCredentialStoreForFirm } from "../plugins/credential-store.ts";
import { devControlPlaneMigrationMiddleware } from "./dev-control-plane-bootstrap.ts";
import { attemptBudgetMiddleware, createAttemptLadder } from "./auth-attempt-budget.ts";
import { registerPreviewServeRoute } from "../files/preview-serve.ts";
import { telemetryErrorHandler, telemetryMiddleware } from "./telemetry-middleware.ts";
import { createUsageConsentResolver } from "../usage/consent.ts";
import { usageReachedMiddleware } from "./usage-reached-middleware.ts";
import { defaultLoggerForEnv } from "../worker-logger.ts";

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
  // Overrides the seal port for tests (a fake SealPort). Production resolves it from the SIGN_SERVICE
  // binding inside the route; while that binding is unset, the route returns 503 (deferred activation).
  sealPort?: SealPort;
  // Overrides the human-verification gate on the anonymous endpoints (a fake verifier, and/or the
  // unconfigured posture this deployment does not run). Production resolves both from the
  // environment inside the handler; no secret is set anywhere, so the default everywhere is the
  // not-configured verifier.
  humanVerification?: HumanVerificationGateOptions;
  // Overrides the sender of a meeting guest's invitation letter for tests, which read the link
  // out of the captured message because the server hands it to nobody else. Production sends
  // through the environment's email adapter.
  meetingGuestMail?: (env: Bindings) => SendEmail;
}

// The chokepoint over the REAL ports: session resolution, firm-context resolution (control-plane
// lookup + the firmId-addressed FirmDatabase DO + member-active check), permission loading, the
// platform-scoped/firm-scoped idempotency gate, and a per-isolate in-memory rate limiter (one limiter
// per instance, never per request). Built once per app; also built by buildDomainOpenAPIDocuments so
// a domain module can be mounted on its own for the contract it declares.
function createProductionChokepoint() {
  const rateLimiter = createInMemoryRateLimiter();
  const ports = createChokepointPorts(authForEnv, rateLimiter);
  return createChokepoint<FirmContext>({
    ...ports,
    idempotency: createChokepointIdempotency(),
  });
}

export function createApp(options: CreateAppOptions = {}) {
  const loggerForEnv = options.loggerForEnv ?? defaultLoggerForEnv;

  // The root router comes from the same constructor every domain sub-app will: the 422 default hook
  // that turns a zod validation failure into the problem document is set there, once, for all of them.
  const app = createDomainApp();

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
  const chokepoint = createProductionChokepoint();

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

  // Local development only: bring the control-plane schema to head before the first API request.
  // `wrangler dev` fires no cron, so without this a fresh Miniflare database answers every route —
  // registration and sign-in first among them — with a 500 until the scheduled handler is curled by
  // hand. Inert in production (gated on the same fail-closed dev signal as the dev seed route) and a
  // ledger-read no-op once the schema is at head. Reasoning: dev-control-plane-bootstrap.ts.
  app.use("/api/*", devControlPlaneMigrationMiddleware);

  // Health is platform plumbing: public, unauthenticated, no /api/v1 surface — it still rides the
  // chokepoint (rate-limit only, no session/firm/RBAC) so EVERY declared route is enforced through
  // the one seam, none reachable that skips it.
  registerHealthRoute(app, chokepoint);

  // Better Auth owns everything under its default basePath, /api/auth/* — its router serves
  // only GET and POST. Registered before the catch-all asset fallthrough, OUTSIDE the chokepoint
  // (it is its own authentication surface, not a /api/v1 route).
  //
  // The attempt budget rides IN FRONT of it, and this is the one place it can: the chokepoint's
  // rate-limit gate is per-route and firm-keyed, which is exactly the wrong shape for a visitor who
  // has no firm yet and is spending one shared budget across the password, the two-factor code and
  // the recovery code. One ladder per app instance, alongside the rate limiter and for the same
  // reason — per-request state would reset on every attempt and limit nothing.
  const attemptLadder = createAttemptLadder();
  app.use("/api/auth/*", attemptBudgetMiddleware(attemptLadder));
  app.on(["GET", "POST"], "/api/auth/*", (c) => authForEnv(c.env).handler(c.req.raw));

  // Slice 2·2: the WOPI host callback surface (/wopi/files/*) — cookieless, access-token-guarded,
  // OUTSIDE the chokepoint (the editor sends no session cookie). The editor's data plane.
  registerWopiHostRoutes(app);
  // The discovery search engine's object surface (/search-objects/*) — cookieless, capability-token
  // guarded, OUTSIDE the chokepoint, for the same reason the WOPI surface is: the caller is the search
  // Container, which holds no session and no R2 credentials. This is where a ranged read by the engine
  // becomes a ranged R2 GET, and where a published split is stamped with its object dimensions.
  registerSplitObjectHostRoutes(app);
  // The socket the media routing service dials to hand a recorder or a captioner a track's audio
  // (/internal/meeting-audio/*) — OUTSIDE the chokepoint for the reason the two surfaces above are:
  // the caller is a Cloudflare service with no session and no cookie. Guarded by a signed, short-lived
  // token per track, and refusing any request that carries an Origin, so no page can ever reach it.
  registerMeetingSinkRoute(app);

  // The /api/v1 surface: every domain module in the manifest, each a sub-app built by
  // createDomainApp and mounted at the root, each route composed through the chokepoint (the one
  // enforcement point). The test seams the modules take are the options, passed through as one
  // object; production passes nothing and every module resolves its own defaults.
  const domainDeps: DomainDeps = {
    whoisDeps: options.whoisDeps,
    safeBrowseDeps: options.safeBrowseDeps,
    sealPort: options.sealPort,
    humanVerification: options.humanVerification,
    meetingGuestMail: options.meetingGuestMail,
  };
  for (const module of DOMAIN_MODULES) module.mount(app, chokepoint, domainDeps);

  // The plugin runtime: production defaults (a fetch-backed http client; the firm_secret store seam,
  // which reports itself unbuilt until the marketplace wires the live credential read), overridable
  // in tests.
  const pluginRuntime: PluginRuntime = {
    httpClient: options.pluginRuntime?.httpClient ?? fetchHttpClient(),
    credentialStoreForFirm:
      options.pluginRuntime?.credentialStoreForFirm ?? integrationCredentialStoreForFirm,
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
    // A guarded write that matched no row reaches the boundary as an ordinary throw from whatever
    // route committed it. Every route means the same thing by it, so the boundary answers it rather
    // than each route wiring its own — and this probe is what pins that, because no route can be made
    // to lose a real race on demand from outside.
    app.get("/api/v1/__telemetry-guard-refusal", () => {
      throw new GuardedWriteRefusedError("telemetry-probe.guard");
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
  // Sorted on a fresh copy, not `toSorted`: that method is absent from this worker's lib target, and
  // an autofixer will offer the swap again.
  document.tags = [...tagNames].toSorted().map((name) => ({ name }));
  return document;
}

// Each domain module's own document, mounted alone on a fresh router: what the module declares,
// attributable to it. The conformance suite holds each module's committed operation list to this.
export function buildDomainOpenAPIDocuments(): ReadonlyMap<
  string,
  ReturnType<typeof emitOpenAPIDocument>
> {
  const chokepoint = createProductionChokepoint();
  const documents = new Map<string, ReturnType<typeof emitOpenAPIDocument>>();
  for (const module of DOMAIN_MODULES) {
    const router = createDomainApp();
    module.mount(router, chokepoint, {});
    documents.set(module.domain, emitOpenAPIDocument(router));
  }
  return documents;
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
