import { Container } from "@cloudflare/containers";

// The OCR engine Container — the HTTP service built from containers/ocr/. Its default fetch()
// proxies to the service; `pingEndpoint` is the boot-readiness probe Cloudflare uses to know the
// freshly-started container is ready (NOT a keep-warm). There is no warm cron: the container scales
// to zero after sleepAfter, so it bills only while a recognition runs. Untrusted, privileged
// document bytes never reach the network: outbound networking is disabled.
//
// Model load at boot is slower than the other engine containers (the ONNX models are ~139 MB), so a
// cold start costs more here. That is still the right trade against paying for an always-on instance,
// and a warm-poke cron is a later tuning decision, off by default.
export class OcrEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "5m";
  override enableInternet = false; // untrusted bytes, and the models are baked in — no egress
  override pingEndpoint = "ready";
}
