import { Container } from "@cloudflare/containers";

// The native-libvips conversion engine Container — a long-lived libvips HTTP service. Its default
// fetch() proxies to the service; the warm cron hits its `ready` endpoint to keep one instance alive.
// Untrusted, privileged document bytes never reach the network: the container runs with outbound
// networking disabled. Additional engines (LibreOffice headless, FFmpeg) become their own Container
// classes here, selected by engineId, when those edges are wired.
//
// The image is a deploy-time build (the in-container libvips service + Dockerfile under
// containers/convert/, like containers/scan) — the engine cannot run under the local test pool, so
// forwardConvert is exercised against a fake container in tests.
export class LibvipsContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "30m"; // the warm-poke cron keeps one instance alive
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
