import { Container } from "@cloudflare/containers";

// The LibreOffice conversion engine Container — the HTTP service built from containers/libreoffice/.
// It converts the registered office edges (docx/odt to PDF, docx and wpd to OpenDocument) inside a
// pool of warm worker child processes, each of which loads the office suite in its own process. The
// suite parses the untrusted document bytes directly, which is exactly why it runs here: sealed in a
// Container with no outbound network, as an isolated child process that can die without taking
// anything with it.
//
// `pingEndpoint` is the boot-readiness probe. This container's /ready is honest — it answers 503
// until a worker has finished suite initialisation — so the probe genuinely means "can convert",
// not "the port is open".
//
// sleepAfter is 15 minutes rather than the raster engine's 5, and the difference is the direct
// consequence of the cold start: the raster container boots in about a second, this one spends
// twenty to thirty seconds initialising the suite. Scaling to zero too eagerly converts a cheap idle
// into an expensive user-visible stall. The right value is a function of real arrival rates, which
// do not exist yet.
//
// The image is a deploy-time build (see containers/libreoffice/Dockerfile) and is roughly a
// gigabyte — an order of magnitude above every other container here, and the single largest cost
// this engine introduces. The engine cannot run under the local test pool, so forwardConvert is
// exercised against a fake container in tests and the real image is built and driven in a container
// CI job.
export class LibreOfficeEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "15m";
  override enableInternet = false; // untrusted bytes reaching a C++ suite — no egress
  override pingEndpoint = "ready";
}
