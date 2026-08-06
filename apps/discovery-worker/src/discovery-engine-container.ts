import { Container } from "@cloudflare/containers";

// The pure-Rust discovery engine Container — the HTTP service built from containers/discovery/.
// Its default fetch() proxies to the service; `pingEndpoint` is the boot-readiness probe Cloudflare
// uses to know the freshly-started container is ready (NOT a keep-warm). There is no warm cron: the
// container scales to zero after sleepAfter, so it bills only while documents are being read.
//
// Untrusted, privileged document bytes never reach the network: the container runs with outbound
// networking disabled. That matters more here than anywhere else in the platform — this is the one
// service whose entire input is files chosen by the party on the other side of a case.
//
// A longer sleepAfter than the interactive engines': a bulk load arrives as a sustained stream of
// documents through the queue lane, so an idle window between two of them is a pause in one job
// rather than the end of the work.
//
// The image is a deploy-time build (cargo build inside Docker — see containers/discovery/Dockerfile,
// built with image_build_context set to the repo root so its shared crate deps resolve). The engine
// cannot run under the local test pool, so forwardDiscovery is exercised against a fake container in
// tests.
export class DiscoveryEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "15m";
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
