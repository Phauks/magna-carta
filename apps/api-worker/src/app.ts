import { GuardedWriteRefusedError } from "@magna-carta/database/guarded-write";
import type { SealPort } from "@magna-carta/signing/port";
import type { Logger } from "@magna-carta/telemetry/logger";
import { authForEnv, emailAdapterForEnv } from "./auth-instance.ts";
import type { Bindings } from "./bindings.ts";
import { createChokepoint } from "./chokepoint/chokepoint.ts";
import type { HumanVerificationGateOptions } from "./human-verification/human-verification-gate.ts";
import { createChokepointIdempotency } from "./chokepoint/idempotency-port.ts";
import { createChokepointPorts, type AppVariables, type FirmContext } from "./chokepoint/ports.ts";
import { createInMemoryRateLimiter } from "./chokepoint/rate-limiter.ts";
import { noindexResponseMiddleware } from "./crawler-directives.ts";
import { createDomainApp } from "./routes/domain-app.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { registerBundleStatusRoute } from "./routes/bundle-status.ts";
import { registerAssembliesRoutes } from "./routes/assemblies.ts";
import { registerConversionRoutes } from "./routes/conversions.ts";
import { registerCustomFieldsRoutes } from "./routes/custom-fields.ts";
import { registerCostsRoutes } from "./routes/costs.ts";
import { registerFeesRoutes } from "./routes/fees.ts";
import { registerBillingRoutes } from "./routes/billing.ts";
import { registerReportsRoutes } from "./routes/reports.ts";
import { registerTrustFirmFundsRoutes } from "./routes/trust-firm-funds.ts";
import { registerTrustReconciliationRoutes } from "./routes/trust-reconciliation.ts";
import { registerTrustUnclaimedFundsRoutes } from "./routes/trust-unclaimed-funds.ts";
import { registerTrustRoutes } from "./routes/trust.ts";
import { registerTimeEntriesRoutes } from "./routes/time-entries.ts";
import { registerTemplatesRoutes } from "./routes/templates.ts";
import { registerTimerRoutes } from "./routes/timer.ts";
import { registerRateCardsRoutes } from "./routes/rate-cards.ts";
import { registerUtbmsCodesRoutes } from "./routes/utbms-codes.ts";
import { registerNonBillableCategoriesRoutes } from "./routes/non-billable-categories.ts";
import { registerNarrativeTemplatesRoutes } from "./routes/narrative-templates.ts";
import { registerMyDayRoutes } from "./routes/my-day.ts";
import { registerFirmNotificationPolicyRoutes } from "./routes/firm-notification-policy.ts";
import { registerFirmProfileRoutes } from "./routes/firm-profile.ts";
import { registerFirmReportPolicyRoutes } from "./routes/firm-report-policy.ts";
import { registerFirmTimePolicyRoutes } from "./routes/firm-time-policy.ts";
import { registerFirmAiSettingsRoutes } from "./routes/firm-ai-settings.ts";
import { registerNotificationPreferencesRoutes } from "./routes/notification-preferences.ts";
import { registerNotificationsRoutes } from "./routes/notifications.ts";
import { registerDirectoryRoutes } from "./routes/directory.ts";
import { registerCalendarRoutes } from "./routes/calendar.ts";
import { registerMatterSearchRoutes } from "./routes/matter-search.ts";
import { registerCommunicationsRoutes } from "./routes/communications.ts";
import { registerNotesRoutes } from "./routes/notes.ts";
import { registerTasksRoutes } from "./routes/tasks.ts";
import { registerMatterPlanRoutes } from "./routes/matter-plans.ts";
import { registerIntakeRoutes } from "./routes/intake.ts";
import { registerConflictsRoutes } from "./routes/conflicts.ts";
import { registerCustodyRoutes } from "./routes/custody.ts";
import { registerMatterAssetRoutes } from "./routes/matter-assets.ts";
import { registerMagnusRoutes } from "./routes/magnus.ts";
import { registerDiscoveryRoutes } from "./routes/discovery.ts";
import { registerDocumentTypesRoutes } from "./routes/document-types.ts";
import { registerDownloadsRoutes } from "./routes/downloads.ts";
import { registerDocumentCheckoutRoutes } from "./editing/checkout-routes.ts";
import { registerDocumentEditingRoutes } from "./editing/edit-session-route.ts";
import { registerWopiHostRoutes } from "./editing/wopi-host.ts";
import { registerSplitObjectHostRoutes } from "./search/split-object-host.ts";
import { registerFilesRoutes } from "./routes/files.ts";
import { registerScanDiagnoseRoute } from "./routes/scan-diagnose.ts";
import { registerUploadReadinessRoute } from "./routes/upload-readiness.ts";
import { registerScanMatterRoute } from "./routes/scan-matter.ts";
import { registerFileScanRoutes } from "./routes/file-scans.ts";
import { registerScanPolicyRoutes } from "./routes/scan-policy.ts";
import { registerFirmsRoute } from "./routes/firms.ts";
import { registerPlatformReleaseChannelRoute } from "./routes/platform-release-channel.ts";
import { registerPlatformStatusRoute } from "./routes/platform-status.ts";
import { registerFoldersRoutes } from "./routes/folders.ts";
import { registerIncidentsRoute } from "./routes/incidents.ts";
import { registerLocationsRoutes } from "./routes/locations.ts";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import { workerPlugins } from "./plugins/registry.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";
import { firmSecretStoreNotYetAvailable } from "./plugins/secret-store.ts";
import { registerMatterTypesRoutes } from "./routes/matter-types.ts";
import { registerMattersRoutes } from "./routes/matters.ts";
import { registerMatterRecordsRoutes } from "./routes/matter-records.ts";
import { registerMemberProfilesRoutes } from "./routes/member-profiles.ts";
import { registerDownloadPreferenceRoutes } from "./routes/download-preferences.ts";
import { registerDownloadRegisterRoutes } from "./routes/downloads-register.ts";
import { registerFirmUsageRoute } from "./routes/firm-usage.ts";
import { registerReportExportRoutes } from "./routes/report-exports.ts";
import { registerToolsConnectionRoute } from "./routes/tools-connection.ts";
import { registerToolsTurnCredentialsRoute } from "./routes/tools-turn-credentials.ts";
import { registerWhoisRoute, type WhoisRouteDeps } from "./routes/whois.ts";
import {
  registerSafeBrowseRoute,
  registerSafeBrowseStreamRoute,
  type SafeBrowseRouteDeps,
} from "./routes/safe-browse.ts";
import { registerDecryptionRoutes } from "./routes/decryption.ts";
import { registerDocumentSealRoutes } from "./routes/document-seal.ts";
import { registerRecoveryRoutes } from "./routes/recovery.ts";
import { registerFileIntegrityRoutes } from "./routes/file-integrity.ts";
import { registerFileTypeRoutes } from "./routes/file-type.ts";
import { registerEmailInspectorRoutes } from "./routes/email-inspector.ts";
import { registerEmailAddInRoutes } from "./routes/email-add-in.ts";
import { registerEmailsRoutes } from "./routes/emails.ts";
import { registerCaptureAddressRoutes } from "./routes/capture-addresses.ts";
import { registerAutoFilePolicyRoutes } from "./routes/auto-file-policy.ts";
import { registerAutoFileRuleRoutes } from "./routes/auto-file-rules.ts";
import { registerFileRepairRoutes } from "./routes/file-repair.ts";
import { registerOcrRoutes } from "./routes/ocr.ts";
import { registerAiDetectionRoutes } from "./routes/ai-detection.ts";
import { registerMetadataRoutes } from "./routes/metadata.ts";
import { registerSupportGrantsRoutes } from "./routes/support-grants.ts";
import { registerSupportSessionsRoute } from "./routes/support-sessions.ts";
import { registerSupportDiagnosticsRoute } from "./routes/support-diagnostics.ts";
import { registerDevWebToolsDemoRoute } from "./routes/dev-web-tools-demo.ts";
import { registerDevR2UploadRoute } from "./routes/dev-r2-upload.ts";
import { registerDevSeedRoute } from "./routes/dev-seed.ts";
import { devControlPlaneMigrationMiddleware } from "./dev-control-plane-bootstrap.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerMetaDatabaseHealthRoute } from "./routes/meta-database-health.ts";
import { registerMetaVersionsRoute } from "./routes/meta-versions.ts";
import { registerMeNameRoutes } from "./routes/me-name.ts";
import { registerMemberAdministrationRoutes } from "./routes/member-administration.ts";
import { registerMembersRoute } from "./routes/members.ts";
import { registerInvitationRoutes } from "./routes/invitations.ts";
import { registerRegistrationRoutes } from "./routes/registrations.ts";
import { registerOnboardingRoutes } from "./routes/onboarding.ts";
import { attemptBudgetMiddleware, createAttemptLadder } from "./auth-attempt-budget.ts";
import { registerReleaseChannelRoute } from "./routes/release-channel.ts";
import { registerNumberingRoutes } from "./routes/numbering.ts";
import { registerUploadsRoutes } from "./routes/uploads.ts";
import { registerPreviewServeRoute } from "./files/preview-serve.ts";
import { telemetryErrorHandler, telemetryMiddleware } from "./telemetry-middleware.ts";
import { createUsageConsentResolver } from "./usage/consent.ts";
import { usageReachedMiddleware } from "./usage/reached-middleware.ts";
import { defaultLoggerForEnv } from "./worker-logger.ts";

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

  // A SECOND ladder, of the same shape and for the same reason, for the anonymous invitation
  // redemption form. It is the budget that route's refusal publishes — the invitation's own count
  // is a fact about the invitation and answering with it would tell a prober whether a guessed code
  // is live (routes/invitations.ts). Separate state from the credential ladder above because the
  // two surfaces ask different questions of different people: a member mistyping their password
  // should not spend a new joiner's tries, or the reverse.
  const invitationRedemptionLadder = createAttemptLadder();

  // The /api/v1 routes, each composed through the chokepoint (the one enforcement point). The
  // public firms route additionally mounts the platform-admin secret guard as route-specific
  // middleware, run before the chokepoint's idempotency/rate-limit gates (see routes/firms.ts).
  registerMeRoute(app, chokepoint);
  registerMetaVersionsRoute(app, chokepoint);
  registerMetaDatabaseHealthRoute(app, chokepoint);
  registerFirmUsageRoute(app, chokepoint);
  registerReportExportRoutes(app, chokepoint);
  registerDownloadRegisterRoutes(app, chokepoint);
  registerDownloadPreferenceRoutes(app, chokepoint);
  registerToolsConnectionRoute(app, chokepoint);
  registerToolsTurnCredentialsRoute(app, chokepoint);

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
  registerSafeBrowseStreamRoute(app, chokepoint, options.safeBrowseDeps ?? {});
  registerDecryptionRoutes(app, chokepoint);
  // Password recovery: mints a job and fans it out through the recovery coordinator Durable
  // Object. Registered beside decryption — the button-initiated surface for the SAME extracted
  // hash decryption.inspect returns inline, handed instead to an offline dictionary search.
  registerRecoveryRoutes(app, chokepoint);
  registerFileIntegrityRoutes(app, chokepoint);
  registerFileTypeRoutes(app, chokepoint);
  registerEmailInspectorRoutes(app, chokepoint);
  // The mail-client surface — matter suggestions, capture status, the member's filing context.
  // Registered BEFORE registerEmailsRoutes deliberately: that bundle owns /api/v1/emails/{id}, and a
  // parameterized route registered first swallows the static siblings on its prefix.
  registerEmailAddInRoutes(app, chokepoint);
  // The auto-file rule management surface. Registered here for the same reason the add-in bundle is:
  // it owns the static /api/v1/emails/auto-file-review, which a parameterized /api/v1/emails/{id}
  // registered first would swallow.
  registerAutoFileRuleRoutes(app, chokepoint);
  registerEmailsRoutes(app, chokepoint);
  // The writer for the forward/CC token index: minting an address is what makes a capture token
  // resolve to a firm and a matter. Registered beside the emails surface it feeds.
  registerCaptureAddressRoutes(app, chokepoint);
  // The firm ceiling on unattended filing, in the same administrative lane as the catch-all address.
  registerAutoFilePolicyRoutes(app, chokepoint);
  registerFileRepairRoutes(app, chokepoint);
  registerOcrRoutes(app, chokepoint);
  registerDocumentSealRoutes(app, chokepoint, options.sealPort);
  registerAiDetectionRoutes(app, chokepoint);
  registerMetadataRoutes(app, chokepoint);
  registerMembersRoute(app, chokepoint, authForEnv);
  registerMemberAdministrationRoutes(app, chokepoint);
  registerMeNameRoutes(app, chokepoint);
  registerReleaseChannelRoute(app, chokepoint, authForEnv);
  registerFirmsRoute(app, chokepoint, authForEnv);
  // Joining the platform: the anonymous registration pair and the invitation pair (one issued
  // inside a firm, one redeemed by someone who has no account yet). Every anonymous one of them
  // rides the chokepoint's tightest rate-limit bucket.
  // The human-verification gate rides the two anonymous WRITES among them — founding a firm and
  // redeeming an invitation. Not the confirmation route: its emailed token is the only credential
  // its caller can hold, and a link opened out of a mailbox has no form to carry a challenge.
  const humanVerification = options.humanVerification ?? {};
  registerRegistrationRoutes(app, chokepoint, emailAdapterForEnv, authForEnv, humanVerification);
  registerInvitationRoutes(
    app,
    chokepoint,
    authForEnv,
    invitationRedemptionLadder,
    humanVerification,
  );
  // The joining surface's signed-in half: the two routes a person with an account and no firm can
  // reach. Same ladder as the anonymous redemption route, so signing in buys no second allowance.
  registerOnboardingRoutes(app, chokepoint, invitationRedemptionLadder);
  registerPlatformReleaseChannelRoute(app, chokepoint);
  registerPlatformStatusRoute(app, chokepoint);
  registerIncidentsRoute(app, chokepoint);
  registerUploadsRoutes(app, chokepoint);
  // Slice 1·1: matters (shell + lifecycle), per-firm matter/document types, Locations, and the
  // numbering-scheme surface — each composed through the same chokepoint.
  registerMattersRoutes(app, chokepoint);
  // The matter's identity records beyond the shell — staffing assignments, the court-case record,
  // and the estate record — plus the member professional profile documents read from.
  registerMatterRecordsRoutes(app, chokepoint);
  registerMemberProfilesRoutes(app, chokepoint);
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
  // The discovery search engine's object surface (/search-objects/*) — cookieless, capability-token
  // guarded, OUTSIDE the chokepoint, for the same reason the WOPI surface is: the caller is the search
  // Container, which holds no session and no R2 credentials. This is where a ranged read by the engine
  // becomes a ranged R2 GET, and where a published split is stamped with its object dimensions.
  registerSplitObjectHostRoutes(app);
  // Slice 2·2: offline checkout / check-in — take a working copy out and return it through the
  // quarantine ingest, reconciling divergence as a human-reviewed conflicting copy.
  registerDocumentCheckoutRoutes(app, chokepoint);
  // The one-off, matter-less malware-scan diagnostic — stream a file through the engine, get a verdict.
  registerScanDiagnoseRoute(app, chokepoint);
  // "Can this firm upload?" answered from the server: the bucket, its three settings, the key.
  registerUploadReadinessRoute(app, chokepoint);
  // "Scan this matter now" — queue a background re-scan of a matter's stale files on the bulk lane.
  registerScanMatterRoute(app, chokepoint);
  registerFileScanRoutes(app, chokepoint);
  // Read and update the firm's malware scan-policy settings (tier, score floor, flagged treatment).
  registerScanPolicyRoutes(app, chokepoint);
  // The async bulk-download poll endpoint — the status side of the download route's 202 hand-off.
  registerBundleStatusRoute(app, chokepoint);
  // Slice 1·3: the directory (persons/organizations, names, sensitive identifiers, edges,
  // categories, search, merge, matter-party link) — composed through the same chokepoint.
  registerDirectoryRoutes(app, chokepoint);
  // The conflicts-of-interest check surface: run a check against the directory corpus, read a
  // completed check back with its hits, and record a reviewer's disposition of a hit.
  registerConflictsRoutes(app, chokepoint);
  // The case calendar: litigation events and deadlines recorded here, plus the matter timeline that
  // federates them with what every other subsystem already recorded — read in place, never copied.
  registerCalendarRoutes(app, chokepoint);

  // The matter note: what the firm wrote down about a case that no other record holds. Corrected by
  // appending a revision, withdrawn by retraction, and never deleted — there is no delete route here
  // because there is no delete path anywhere in the subsystem.
  registerNotesRoutes(app, chokepoint);
  registerCommunicationsRoutes(app, chokepoint);
  registerMatterSearchRoutes(app, chokepoint);
  registerTasksRoutes(app, chokepoint);
  registerMatterPlanRoutes(app, chokepoint);
  registerIntakeRoutes(app, chokepoint);
  // Custodian — the register of physical client originals the firm holds in safekeeping: the
  // container tree, packets and their items, Directory ownership, the append-only movement ledger,
  // holds, and scanned copies bound over ordinary File Manager files.
  registerCustodyRoutes(app, chokepoint);
  // The matter asset register — what a client or an estate owns, kept on the matter: the asset row
  // and its class attributes, the append-only value history and its as-of reads, interests held by
  // directory entities, links to documents that stay ordinary matter files, and account numbers
  // sealed to their last four characters. Beside Custodian on purpose: the two are the register
  // pair, and the boundary between them (property in the client's ownership, against objects in the
  // firm's possession) is the first thing a reader of either one needs.
  registerMatterAssetRoutes(app, chokepoint);
  // Magnus — the conversational assistant: the conversation and turn record, the two fail-closed
  // consent gates, the submit-and-watch path, and the transcript reads. Every route here refuses
  // unless the firm has opened both gates, and the default adapter reaches no provider.
  registerMagnusRoutes(app, chokepoint);
  // Discovery — the corpus of documents under review on a matter: the review set, whose records are
  // in it, what was loaded and when, and the internal load lanes that resolve the firm's own files
  // and filed email into review documents without moving a byte. Its own permission namespace, so
  // matter access alone reaches nothing here.
  registerDiscoveryRoutes(app, chokepoint);
  // Slice 1·4: firm-defined custom fields (definitions, picklist options, temporal values, the
  // non-destructive Convert, and the compliance purge seam) — composed through the same chokepoint.
  registerCustomFieldsRoutes(app, chokepoint);
  // Costs / disbursements — the cost-entry WIP store, composed through the same chokepoint.
  registerCostsRoutes(app, chokepoint);
  registerFeesRoutes(app, chokepoint);
  // Trust accounting movements: client money into a matter's trust ledger, out of it, and
  // reallocated between two matters of one client, plus the client ledger those movements build.
  registerTrustRoutes(app, chokepoint);
  registerTrustReconciliationRoutes(app, chokepoint);
  // The firm's OWN money in a trust account — the bank-charge carve-out, on its own capability and
  // in its own module, because firm money and client money never share a door.
  registerTrustFirmFundsRoutes(app, chokepoint);
  // Reporting — projections over records the firm already holds. Read-only by construction: the
  // reporting package composes nothing, and every route registered here is a GET.
  registerReportsRoutes(app, chokepoint);
  // Unclaimed client funds: the dormancy read against a window the caller states, and the diligence
  // file that evidences the search. Nothing on that surface moves money.
  registerTrustUnclaimedFundsRoutes(app, chokepoint);
  // Billing — the invoice spine: draft, claim work-in-progress, review the lines, finalize (the one
  // batch that draws the number, locks the work, and posts the receivable), and the reads over it.
  registerBillingRoutes(app, chokepoint);
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
  // The member's own notification feed: one page, the unread counts, and settling an item. Every
  // read is scoped to the session's user and filtered by matter visibility in SQL.
  registerNotificationsRoutes(app, chokepoint);
  // What that feed is allowed to carry: the member's own per-category matrix under the firm's
  // in-app floor, and the firm's trust-compliance designation.
  registerNotificationPreferencesRoutes(app, chokepoint);
  // The FIRM's tier of the same policy — the in-app floor no member may lower, the retention window,
  // and the local hour the summary email lands. A firm-administration act, so it carries its own
  // permission rather than the member key beside it.
  registerFirmNotificationPolicyRoutes(app, chokepoint);
  registerFirmProfileRoutes(app, chokepoint);
  registerFirmReportPolicyRoutes(app, chokepoint);
  registerFirmTimePolicyRoutes(app, chokepoint);
  // The firm's AI settings: the two consent gates read by apps/api-worker/src/magnus/consent.ts,
  // plus the assistant's daily ceiling and the stated facts about the model in force. The only
  // writer of those gates — until this landed, a firm could not open either one.
  registerFirmAiSettingsRoutes(app, chokepoint);
  // The server-conversion surface: presign an upload slot, submit a job, and poll its state.
  // Each route traverses the same chokepoint under the tools:fileConverter permission.
  registerConversionRoutes(app, chokepoint);
  // Document automation: the firm's template catalogue (register, version, list, inspect fields,
  // archive) plus the merge-field dictionary a template is authored against.
  registerTemplatesRoutes(app, chokepoint);
  // Document automation: submit an assembly onto a matter and poll it. Matter-rooted, so an assembly
  // carries the matter's ethical wall like every other document operation.
  registerAssembliesRoutes(app, chokepoint);
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

  // The plugin runtime: production defaults (a fetch-backed http client; the firm_secret store seam,
  // which reports itself unbuilt until the marketplace wires the live credential read), overridable
  // in tests.
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
    // A guarded write that matched no row reaches the boundary as an ordinary throw from whatever
    // route committed it. Every route means the same thing by it, so the boundary answers it rather
    // than each route wiring its own — and this probe is what pins that, because no route can be made
    // to lose a real race on demand from outside.
    app.get("/api/v1/__telemetry-guard-refusal", () => {
      throw new GuardedWriteRefusedError("telemetry-probe.guard");
    });
  }

  // Throwaway dev-only demo page for the Websites & Domains tools (gated on DEV_DEMO_TOOLS; 404 in
  // production). A bare route, so it never enters the OpenAPI contract. Remove with the demo file.
  registerDevWebToolsDemoRoute(app);

  // The development-only R2 upload target: stands in for direct-to-R2 uploads under `wrangler dev`
  // (where no presigned R2 host resolves and no R2 event fires). It serves its route only when the
  // real R2 S3 credential set is absent — the same fail-closed signal that makes presignerForEnv
  // return the dev presigner (routes/dev-r2-upload.ts, presigner-wiring.ts) — so it answers a bare 404
  // in production. Behind the chokepoint (session -> files:upload) and validates the object key against
  // the firm's upload session. A bare route under /api/__dev, so it never enters the OpenAPI contract.
  registerDevR2UploadRoute(app, chokepoint);

  // The development-only firm seeder: stands up a complete signed-in-ready tenant (firm + owner user +
  // matter + files) so a developer can log in and see real data under `wrangler dev`. Gated on the same
  // real-credential absence as the dev upload route, so it answers a bare 404 in production. Outside the
  // chokepoint (it bootstraps the first user) and a bare route under /api/__dev, so it never enters the
  // OpenAPI contract.
  registerDevSeedRoute(app);

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
