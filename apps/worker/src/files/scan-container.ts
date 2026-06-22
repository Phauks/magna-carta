import { Container } from "@cloudflare/containers";

// The malware-scan Container (slice 2·1 Plan 2) — a long-lived clamd daemon + the Rust scan service.
// Its default fetch() proxies to the Rust service on :8080; the warm-poke cron hits its `ready` health
// endpoint to keep one instance (and clamd's signature DB) resident. Untrusted bytes never reach the
// network: the container runs with outbound networking disabled.
//
// Wiring this on in production is a deploy-time step — the wrangler `containers` + `durable_objects`
// binding + `new_sqlite_classes` migration are added alongside building and pushing the image (the scan
// engine cannot run under the local test pool, so it has no test-environment binding). resolveScanPort
// is the one-line seam that selects this adapter once the binding is present.
export class ScanContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "30m"; // generous; the warm-poke cron keeps one instance alive
  override enableInternet = false; // the container processes untrusted bytes — no egress
  override pingEndpoint = "ready";
}
