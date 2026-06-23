import { Container } from "@cloudflare/containers";

// The pure-Rust raster conversion engine Container — the HTTP service built from containers/raster/.
// Its default fetch() proxies to the service; `pingEndpoint` is the boot-readiness probe Cloudflare
// uses to know the freshly-started container is ready (NOT a keep-warm). There is no warm cron: the
// container scales to zero after sleepAfter, so it bills only while a conversion runs. Untrusted,
// privileged document bytes never reach the network: the container runs with outbound networking
// disabled. Additional engines (LibreOffice headless, FFmpeg) become their own Container classes
// here, selected by engineId, when those edges are wired.
//
// The image is a deploy-time build (cargo build inside Docker — see containers/raster/Dockerfile).
// The engine cannot run under the local test pool, so forwardConvert is exercised against a fake
// container in tests.
export class RasterEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "5m"; // scale to zero ~5 min after the last conversion — no always-on cost
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
