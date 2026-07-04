import { Container } from "@cloudflare/containers";

// The pure-Rust file-recovery engine Container — the HTTP service built from containers/file-repair/.
// Its default fetch() proxies to the service; `pingEndpoint` is the boot-readiness probe Cloudflare
// uses to know the freshly-started container is ready (NOT a keep-warm). There is no warm cron: the
// container scales to zero after sleepAfter, so it bills only while a diagnose/repair/carve runs.
// Untrusted, privileged document bytes never reach the network: the container runs with outbound
// networking disabled.
//
// The image is a deploy-time build (cargo build inside Docker — see containers/file-repair/Dockerfile,
// built with image_build_context set to the repo root so its shared crate deps resolve). The engine
// cannot run under the local test pool, so forwardFileRepair is exercised against a fake container in
// tests.
export class FileRepairEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "5m"; // scale to zero ~5 min after the last request — no always-on cost
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
