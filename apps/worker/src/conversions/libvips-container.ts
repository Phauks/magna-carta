import { Container } from "@cloudflare/containers";

// The native-libvips conversion Container: a tiny HTTP service that takes the source bytes + the target
// recipe and returns the converted bytes. enableInternet is off — it processes untrusted file bytes and
// must not egress (the cross-cutting untrusted-input posture). The warm-poke cron hits `ready`. Wiring
// the real image (wrangler `containers` binding + the image build) is a deploy-time step; under the
// local test pool there is no binding and resolveEnginePort returns the deferred port instead.
export class LibvipsContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "30m";
  override enableInternet = false;
  override pingEndpoint = "ready";
}
