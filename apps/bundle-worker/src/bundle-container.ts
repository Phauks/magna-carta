import { Container } from "@cloudflare/containers";

// The bundle Container — a Rust-based archive builder that reads source files from R2 via the
// outbound R2 handler and writes the assembled archive back to R2. The container has no real
// internet egress; all R2 access is brokered by this worker's "bundle-r2" outbound handler.
//
// Wiring this on in production is a deploy-time step — the wrangler `containers` + `durable_objects`
// binding + `new_sqlite_classes` migration are added alongside building and pushing the image (the
// bundle container cannot run under the local test pool). The outbound R2 handler is unit-tested
// independently with a fake R2 bucket.
export class BundleContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "10m"; // the warm-poke cron fires every 8 minutes to keep one instance alive
  override enableInternet = false; // R2 is reached via the outbound handler, not real egress
  override pingEndpoint = "ready";
}
