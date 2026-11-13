import type { AnalyticsEngineDataset } from "@magna-carta/telemetry/workers-logger";
import type { CloudflareEmailBinding } from "./email-cloudflare.ts";

// The Worker's runtime bindings, declared once here: the no-barrel single home for the env shape,
// which the HTTP side (app.ts and the route modules) and the background side (the queue consumers,
// the Cron sweeps, the Durable Objects) both import. It lives apart from app.ts on purpose — the
// consumers and the objects need the env shape and nothing else the composition root builds, so
// this module is the one thing they may share with it. worker-env.d.ts mirrors it into the ambient
// `Cloudflare.Env` the @cloudflare/vitest-plugin harness types `env` as.
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
  // One live browsing session per member, addressed idFromName(`${firmId}:${userId}`). Holds the
  // remote browser's session id and an idle alarm — never the handle, never any history.
  SAFE_BROWSE_SESSION: DurableObjectNamespace<
    import("./safe-browse/safe-browse-session.ts").SafeBrowseSession
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
  // (src/background/inference/inference-consumer.ts) reaches the model binding, so a single firm cannot starve the shared
  // gateway cap synchronously on the request path. Distinct from QUEUE (jobs) and FILES_INGEST.
  INFERENCE: Queue;
  // The email-capture queue: both entrances (the forward/CC Email Worker and the authenticated
  // file-to-matter API) enqueue a pointer to the staged raw MIME; the emails-capture consumer runs the
  // parse/dedup/thread-link/attachment work off the request path.
  EMAILS_CAPTURE: Queue<import("./emails/capture-types.ts").EmailsCaptureMessage>;
  // The conversion-job coordinator: keyed firmId:jobId, single-flights one conversion per job.
  CONVERSION_JOB: DurableObjectNamespace<
    import("./conversions/conversion-coordinator.ts").ConversionJob
  >;
  // The server-conversion queue the coordinator enqueues onto; the consumer runs the ConversionPort adapter.
  CONVERSION: Queue<import("./conversions/conversion-types.ts").ConversionQueueMessage>;
  // The document-assembly job coordinator: keyed firmId:assemblyId, single-flights one assembly per job
  // so a retried submit can never file two documents onto a matter.
  DOCUMENT_ASSEMBLY_JOB: DurableObjectNamespace<
    import("./assemblies/assembly-coordinator.ts").DocumentAssemblyJob
  >;
  // The document-assembly queue the coordinator enqueues onto. The message carries IDENTIFIERS ONLY —
  // the consumer resolves the merge context, which never leaves its memory.
  DOCUMENT_ASSEMBLY: Queue<import("./assemblies/assembly-types.ts").DocumentAssemblyMessage>;
  // The conversational assistant's push surface: one Durable Object per conversation, keyed
  // firmId:conversationId. It STORES NOTHING — it reads a turn's state back from the firm's own
  // database and pushes it, so exactly one copy of a transcript exists.
  MAGNUS_CONVERSATION: DurableObjectNamespace<
    import("./magnus/magnus-conversation.ts").MagnusConversation
  >;
  // The assistant's off-hot-path work queue. The message carries IDENTIFIERS ONLY — what the member
  // typed stays in the turn row the consumer reads back through the firm-scoped data-access layer.
  MAGNUS: Queue<import("./magnus/magnus-types.ts").MagnusTurnJob>;
  // Selects the assistant's inference implementation at deploy time. ABSENT IS THE DEFAULT AND THE
  // DEFAULT IS THE DETERMINISTIC STUB, which reaches no provider; only the literal value "gateway"
  // selects the real gateway port. The firm-level consent settings still gate every request on top of
  // this — turning the assistant on is two deliberate acts, not one.
  MAGNUS_INFERENCE_ADAPTER?: string;
  // One discovery load's fan-out coordinator, keyed firmId:loadId. It holds the load's CURSOR in
  // durable storage and nothing on the instance, so eviction, deploy, and hibernation are lossless —
  // a load at the ceiling is a quarter of a million documents, and one that had to start over would
  // be hours of repeated work.
  DISCOVERY_LOAD_JOB: DurableObjectNamespace<
    import("./discovery/discovery-load-coordinator.ts").DiscoveryLoadCoordinator
  >;
  // The per-document processing lane. One review document per message — identifiers and keys only,
  // never bytes — kept apart from every ingest lane so a quarter-million-document load cannot starve
  // interactive file upload.
  // It also carries the one completion message a load sends when its last document reaches a
  // terminal state, which is what writes the manifest and the exception report.
  DISCOVERY_PROCESS: Queue<import("./discovery/discovery-process-types.ts").DiscoveryLaneMessage>;
  // The dedicated discovery engine worker (magna-carta-discovery), reached over a service binding. It
  // owns the pure-Rust extraction Container (crates/discovery-core): identify from bytes, native text
  // extraction, page counts, document dates, and the near-duplicate fingerprint. Optional: absent in
  // every test environment and until the deploy-time binding is added; while unset, the extraction
  // port falls back to the in-Worker PDF reader plus recognition, which reads strictly less.
  DISCOVERY_SERVICE?: Fetcher;
  // The dedicated conversion engine worker (magna-carta-convert), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, resolveEnginePort returns the deferred port (engine-not-implemented).
  CONVERT?: Fetcher;
  // The dedicated file-repair engine worker (magna-carta-file-repair), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, the file-repair routes return 503 (the same posture the file-type and bundle routes take).
  FILE_REPAIR_SERVICE?: Fetcher;
  // The password-recovery job coordinator: fans a recovery job out across shards and aggregates
  // outcomes into the job's final state.
  RECOVERY_JOB: DurableObjectNamespace<
    import("./recovery/recovery-coordinator.ts").RecoveryJobCoordinator
  >;
  // The recovery shard queue the coordinator enqueues onto; the consumer runs one dictionary/rule
  // shard and reports its outcome back to the coordinator.
  RECOVERY_QUEUE: Queue<import("./recovery/recovery-types.ts").RecoveryShardMessage>;
  // The dedicated password-recovery worker (magna-carta-recovery), reached over a service binding.
  // Optional here so the pool can start without a running recovery worker.
  RECOVERY_SERVICE?: Fetcher;
  // The dedicated text-recognition engine worker (magna-carta-ocr), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, the ocr route returns 503 (the same posture the file-type and file-repair routes take).
  OCR_SERVICE?: Fetcher;
  // The dedicated e-signature/seal engine worker (magna-carta-sign), reached over a service binding.
  // It alone holds the platform signing key. Optional: absent in every test environment and until the
  // deploy-time binding is added; while unset, the seal route returns 503 (deferred activation).
  SIGN_SERVICE?: Fetcher;
  // The dedicated discovery search-index worker (magna-carta-search), reached over a service binding.
  // It owns the Tantivy engine Container (crates/search-core) and range-reads splits from R2. Bound in
  // wrangler.jsonc; the test pool binds a stub that refuses every operation (vitest.config.ts). It
  // stays optional because a deployment may be without it (a preview, a rollback), and while unset
  // resolveSearchIndexPort returns the deferred port (engine-not-implemented).
  SEARCH_SERVICE?: Fetcher;
  // The dedicated address engine worker (magna-carta-address), reached over a service binding. It owns
  // the OpenAddresses index Containers and the platform bucket the index lives in. Optional: absent in
  // every test environment and until the deploy-time binding is added; while unset, US addresses are
  // suggested by Smarty when its secrets are set and by nothing otherwise
  // (address-lookup/address-lookup-engine.ts).
  ADDRESS_SERVICE?: Fetcher;
  // The in-app document-editing worker (magna-carta-edit), reached over a service binding ONLY for
  // the aggregate version read — the editing traffic itself flows the other way (that worker calls
  // this one's WOPI host over its own APP_WORKER binding). Optional: absent in every test
  // environment; while unset, its version row reads "unbound".
  EDIT_SERVICE?: Fetcher;
  // The inbound email-capture worker (magna-carta-email), for the aggregate version read alone —
  // capture itself arrives over Cloudflare Email Routing plus the shared queue, never over HTTP.
  // Optional, and DELIBERATELY absent from wrangler.jsonc today: the worker is not on the account
  // yet, and a service binding naming a missing worker fails this worker's own deploy. The binding
  // line lands with that worker's first deploy (docs/deploy-queue.md, email capture activation).
  EMAIL_SERVICE?: Fetcher;
  // The public status-page worker (magna-carta-status), for the aggregate version read alone — the
  // status page's own data flows through KV, never through this worker. Optional: absent in every
  // test environment; while unset, its version row reads "unbound".
  STATUS_SERVICE?: Fetcher;
  // The assets-only SPA worker (magna-carta-web) — since the 2026-08-31 cutover the Worker that
  // serves the interface at the app's address — bound here for the aggregate version read alone.
  // It holds no script, so the probe is answered by its asset server: the SPA build emits the
  // version shape as a static /__version file, and a deployment older than that file answers
  // index.html, which the probe reads as "unreported". Optional: absent in every test environment.
  WEB_SERVICE?: Fetcher;
  // The community board's worker (magna-carta-community), for the aggregate version read alone; the
  // board's data is the control plane's, never read through this binding. Optional, and NOT declared
  // in wrangler.jsonc yet: a service binding to a worker the account does not have fails the deploy,
  // so it is added once magna-carta-community has deployed. Until then its row reads "unbound".
  COMMUNITY_SERVICE?: Fetcher;
  // The managed natural-language search MANAGEMENT binding: creates and destroys one instance per
  // firm from queue-dispatched work, and never from a request handler. Optional, and absent in every
  // environment today — while unset, resolveNaturalLanguageProvisioningPort returns the
  // not-configured port whose every operation reports `binding-not-configured`, so a provisioning job
  // records a failure rather than a control-plane row claiming an instance that does not exist.
  AI_SEARCH_NAMESPACES?: import("./search/natural-language-binding.ts").NaturalLanguageNamespaceBinding;
  // The managed natural-language search QUERY binding. Optional, and absent in every environment
  // today. An ABSENT binding resolves to the default port whose every call reports
  // `instance-not-provisioned` — a misconfigured environment produces an obviously-unavailable
  // feature rather than a silent empty result, which would be indistinguishable from a corpus in
  // which nothing matched.
  AI_SEARCH?: import("./search/natural-language-binding.ts").NaturalLanguageInstanceBinding;
  // The search-index job coordinator: keyed firmId:documentId:version, single-flights one index build
  // per document version and holds its outcome — including the `deferred` state a job parks in while the
  // engines are undeployed.
  SEARCH_INDEX_JOB: DurableObjectNamespace<import("./search/index-coordinator.ts").SearchIndexJob>;
  // The search-index queue the coordinator enqueues onto; the consumer extracts a document version's
  // text, builds its split through the SearchIndexPort, and converges the per-firm split catalog.
  SEARCH_INDEX: Queue<import("./search/index-types.ts").SearchIndexMessage>;
  // One object per connected calendar account, keyed `${firmId}:${connectionId}`. Every pass that
  // writes a member's events to their own calendar runs inside that account's object, one at a time
  // (calendar-sync/connection-sync.ts).
  CONNECTION_SYNC: DurableObjectNamespace<
    import("./calendar-sync/connection-sync.ts").ConnectionSync
  >;
  // The split-compaction coordinator: keyed firmId:corpusId, and keyed that way because two concurrent
  // compactions of one corpus would each merge overlapping splits and leave every document in the
  // overlap live in two merged splits at once.
  SEARCH_COMPACTION_JOB: DurableObjectNamespace<
    import("./search/compaction-coordinator.ts").SearchCompactionJob
  >;
  // The compaction queue: the consumer merges a corpus's small splits into one, publishes it, and swaps
  // the per-firm catalog in a single batch. Never on a query or a request path — a merge is proportional
  // to the bytes it reads and the corpus decides those.
  SEARCH_COMPACTION: Queue<import("./search/compaction-types.ts").SearchCompactionMessage>;
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
  // Cloudflare REST FirmResourceProvider credentials — deploy-time secrets (`wrangler secret put`),
  // REQUIRED by the wrangler.jsonc gate so a production deploy cannot run the development adapter,
  // and deliberately absent from .dev.vars: locally the development adapter runs instead, selected
  // by these being unset (firm-provisioner-wiring.ts). Optional in the type because that local
  // absence is real; the gate, not the type, is what makes them present in a deployment.
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
  // The name of the bucket bound above as R2. An R2Bucket handle carries no name, so the bucket
  // resolver (files/firm-bucket.ts) cannot otherwise tell whether the bucket a presigned URL
  // addresses is the same one this Worker reads through — which is exactly the mismatch that would
  // send a firm's uploaded bytes somewhere no read path can reach. A public resource name, not a
  // secret: bound via wrangler.jsonc vars alongside the binding it names.
  R2_BUCKET_NAME?: string;
  // The zone every forward/CC capture address lives on (e.g. in.magnacarta.esq) — the mint composes
  // `<token>@<this>` so a person can copy the address straight out of the response. A public hostname,
  // not a secret: bound via wrangler.jsonc vars. Optional, because the same default the receiving
  // Email Worker applies (@magna-carta/email-filing/capture-address) is correct for the production
  // zone; a deployment on another zone sets it here and on that worker together.
  CAPTURE_ROOT_DOMAIN?: string;
  // The DNS-over-HTTPS endpoint the DKIM verifier resolves selector key records through. A public
  // resolver URL, not a secret; optional, because the default in emails/dkim-dns-resolver.ts is the
  // right one for production and a deployment that wants its own resolver sets it here.
  DKIM_RESOLVER_URL?: string;
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
  // The deployment's public origin (e.g. https://app.magnacarta.esq). Public configuration, never a
  // secret. Every request-serving path derives its own origin from the request; this exists for the
  // background passes that have no request to derive one from — today, the notification digest,
  // whose one link back into the product cannot be built without it. Absent, that pass reports an
  // honest not-configured reason and mails nobody (notifications/digest-send-port.ts).
  APP_BASE_URL?: string;
  // The community board's sign-in: the secret the one-minute link to community.magnacarta.esq is
  // signed with, shared with apps/community-worker and nothing else (never AUTH_SECRET). Absent, the
  // link route answers 503 and the board stays readable to everyone. COMMUNITY_BASE_URL overrides
  // the board's address for a non-production deployment.
  COMMUNITY_HANDOFF_SECRET?: string;
  COMMUNITY_BASE_URL?: string;
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
  // The platform-status KV namespace: holds the two writer-owned documents (status:derived from the
  // cron probe/telemetry sweep, status:authored from the platform-operator event/override routes) that
  // the published-status read path merges. A KV namespace (not D1) because the whole document is small,
  // read far more than written, and needs no relational query — a single get/put per writer.
  STATUS_KV: KVNamespace;
  // The platform-managed AI-text-detection provider key + base URL. Optional: absent in tests and
  // until the deploy-time secret is set, in which case the detection route reports detection
  // unavailable. A platform secret, never a per-firm credential; production sets it with
  // `wrangler secret put PANGRAM_API_KEY`. PANGRAM_BASE_URL is public config (a var, not a secret) and
  // is an OPTIONAL override only: PANGRAM_MODE alone selects the correct default host (async-task ->
  // the external-api host, sync -> the /v3 host); set PANGRAM_BASE_URL only to point at something else.
  PANGRAM_API_KEY?: string;
  // A read-only Anthropic API key used for one thing: listing the models the provider publishes, so
  // the AI settings screen can say whether each curated model is still served and which newer ones
  // await verification (src/inference/provider-roster-source.ts). Optional: absent, the screen shows
  // the curated roster alone and says the live check is not configured. It never carries inference —
  // that goes through the AI binding — and nothing it returns can make a model selectable. A platform
  // secret: `wrangler secret put ANTHROPIC_MODELS_API_KEY`.
  ANTHROPIC_MODELS_API_KEY?: string;
  PANGRAM_BASE_URL?: string;
  // Which Pangram surface the platform key is provisioned for: "async-task" (the external-api that
  // returns a task to poll) or "sync". Optional; defaults to "async-task". A public config value, not
  // a secret — bound via wrangler vars.
  PANGRAM_MODE?: "async-task" | "sync";
  // The Cloudflare Turnstile secret key the anonymous endpoints verify a challenge solution
  // against, server-side. Optional, and ABSENT IS THE SHIPPED STATE: no widget has been created, so
  // every environment resolves the not-configured verifier
  // (human-verification/human-verification-wiring.ts) and the protected endpoints behave exactly as
  // they did before the gate existed — while counting every unprotected pass. Production sets it
  // with `wrangler secret put TURNSTILE_SECRET_KEY`, and doing so is what switches enforcement on.
  // Deliberately NOT in wrangler.jsonc's secrets.required: listing it would make every deploy fail
  // until a credential nobody has provisioned exists. Never logged, never echoed to a caller.
  TURNSTILE_SECRET_KEY?: string;
  // The Microsoft application members sign in to their own Microsoft 365 account through, for
  // calendar sync. The client id is public configuration and the secret is a secret
  // (`wrangler secret put MICROSOFT_CLIENT_SECRET`). Optional, and the feature is dormant without
  // them: with either absent no member is offered an Outlook connection and the sign-in route
  // answers that this deployment cannot do it (src/calendar-sync/microsoft-application.ts).
  // MICROSOFT_TENANT narrows sign-in to one tenant; absent, any work, school or personal account
  // may sign in.
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT?: string;
  // The Smarty key pair behind address autocomplete (address-lookup/address-lookup-engine.ts).
  // Optional, and ABSENT IS THE SHIPPED STATE: with either missing, every request gets the deferred
  // port and the address form behaves exactly as it did before autocomplete existed. Production sets
  // both with `wrangler secret put SMARTY_AUTH_ID` and `wrangler secret put SMARTY_AUTH_TOKEN`, and
  // doing so is what switches suggestions on — and starts the provider's meter. Deliberately NOT in
  // wrangler.jsonc's secrets.required, for the same reason as the Turnstile key. Never logged, never
  // echoed to a caller: Smarty takes them in the query string, so the adapter never quotes a URL.
  SMARTY_AUTH_ID?: string;
  SMARTY_AUTH_TOKEN?: string;
  // The Telnyx API key behind the call record's "Look up caller ID" (caller-lookup/
  // caller-lookup-engine.ts). Optional, and ABSENT IS THE SHIPPED STATE: without it the record shows
  // the free Directory match and area-code region and offers no paid lookup at all. Production sets
  // it with `wrangler secret put TELNYX_API_KEY`, and doing so is what switches the button on — and
  // starts the per-query bill. Not in wrangler.jsonc's secrets.required, for the same reason as the
  // Turnstile key. Never logged, never echoed to a caller.
  TELNYX_API_KEY?: string;
  // What a protected anonymous endpoint does when no verifier is provisioned: "fail-open" (the
  // default — serve, unprotected, and count it) or "fail-closed" (refuse). Public deployment
  // configuration, not a secret: bound via wrangler.jsonc vars. An unset or unrecognized value takes
  // the default, so a typo here cannot close the front door.
  HUMAN_VERIFICATION_POSTURE?: "fail-open" | "fail-closed";
  // Cloudflare Realtime TURN key credentials — mint short-lived relay credentials for the
  // packet-loss measurement in the Network Speed Test tool. Optional: absent in tests and until the
  // owner provisions a Realtime TURN key, in which case the route answers 503 and the tile states
  // that packet loss is not configured. Production sets both with `wrangler secret put`. Never
  // logged, and never echoed back to a caller.
  REALTIME_TURN_TOKEN_ID?: string;
  REALTIME_TURN_TOKEN_SECRET?: string;
  // Cloudflare Realtime SFU (selective forwarding unit) application credentials — the routing
  // service every meeting's audio, video and screen share flows between browsers through. The media
  // never touches this Worker; what these authorize is the signaling the meeting room brokers on a
  // participant's behalf. Optional: absent in tests and until the owner provisions a Realtime
  // application, in which case the create and join routes answer 503 and the calendar offers no way
  // to start a meeting. Production sets both with `wrangler secret put`. Never logged, never echoed
  // back to a caller, and never sent to a browser — a participant talks to the routing service over
  // the session the room opens for it, holding no credential of its own.
  REALTIME_SFU_APP_ID?: string;
  REALTIME_SFU_APP_SECRET?: string;
  // Whether new meetings open end-to-end encrypted: "on" to open them sealed, anything else (or
  // nothing) to open them in the clear. Public deployment configuration, not a secret: bound via
  // wrangler.jsonc vars once the browsers' frame transform has been tried against the live routing
  // service. Read in one place, `meetings/encryption-switch.ts`.
  MEETINGS_END_TO_END_ENCRYPTION?: string;
  // One meeting's signaling room, keyed `${firmId}:${meetingId}`. It brokers each browser's session
  // with the routing service and keeps the roster; it holds no media and stores nothing anybody
  // said. Addressed by the SESSION firm id at the route, never a path value.
  MEETING_ROOM: DurableObjectNamespace<import("./meetings/meeting-room.ts").MeetingRoom>;
  // One recording's sink, keyed `${firmId}:${recordingId}`: the Durable Object the routing service's
  // WebSocket adapters dial, one socket per recorded track, which stages each track's audio in the
  // firm's own bucket. Not hibernating — it receives fifty frames a second per track while it works.
  // Optional, because a deployment that does not bind it cannot record, and the start route answers
  // 503 `meeting-recording-not-configured` rather than failing deeper in.
  MEETING_RECORDER?: DurableObjectNamespace<
    import("./meetings/meeting-recorder.ts").MeetingRecorder
  >;
  // One meeting's live captions, keyed `${firmId}:${meetingId}`: the routing service's adapters dial
  // it for whoever is speaking, and it streams their audio to the caption model. Optional for the
  // recorder's reason.
  MEETING_CAPTIONER?: DurableObjectNamespace<
    import("./meetings/meeting-captioner.ts").MeetingCaptioner
  >;
  // The secret the recorder signs each track's sink address with (meetings/sink-token.ts) — its own,
  // rather than AUTH_SECRET, because the token rides an address and the secret behind it must be one
  // whose rotation costs nothing but the recordings running at that moment. Optional, and ABSENT IS
  // THE SHIPPED STATE until the owner has proved the routing service preserves the sink address and
  // set it with `wrangler secret put MEETING_SINK_SIGNING_KEY`: absent, recording answers 503 and the
  // Record control is not offered. Never logged, never echoed, never sent anywhere.
  MEETING_SINK_SIGNING_KEY?: string;
  // The queue a stopped recording is handed to for composing (meetings/recording-compose-consumer.ts):
  // one message per bounded window of the mix, each re-enqueuing the next, so an hours-long recording
  // is composed off every request path and inside a queue consumer's budget. Optional, and NOT BOUND
  // in wrangler.jsonc until its queue exists in the account: Workers Builds fails a deploy that binds
  // a queue which does not exist. A recording stopped while it is absent waits in `composing`, and the
  // sweep hands it on once it is bound.
  MEETING_RECORDING_COMPOSE?: Queue;
};
