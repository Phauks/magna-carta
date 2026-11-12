import { Container } from "@cloudflare/containers";

// The audio/video transcode engine Container — the HTTP service built from containers/transcode/. It
// turns an MP4, QuickTime or Matroska file carrying H.264 or HEVC into an MP4 every browser plays:
// H.264 copied when it already plays, otherwise decoded and re-encoded, with the sound copied when
// it is AAC and encoded to AAC otherwise. Everything in it is pure Rust, so the untrusted video bytes
// never reach a C codec library. It spools the request body and the rendition to its own disk, so a
// large video costs disk rather than memory.
//
// sleepAfter is 10 minutes: the container boots in about a second, but a conversion can run for a
// long time and a reader who asked for one tends to ask for the next file soon after.
export class TranscodeEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "10m";
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
