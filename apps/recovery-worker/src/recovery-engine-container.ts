import { Container } from "@cloudflare/containers";

// The password-recovery Container — runs the Rust recovery engine (hashcat-compatible word-rule
// engine + bundled wordlists) on port 8080. Only the hash shard is sent in; the container has no
// egress (enableInternet = false) and no file bytes ever transit the network. The engine loads its
// bundled wordlists quickly, so a shorter sleepAfter is appropriate compared with long-lived daemons.
export class RecoveryEngineContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "10m"; // wordlists load fast; shorter warm window than a persistent daemon
  override enableInternet = false; // only a hash shard comes in — no egress needed
  override pingEndpoint = "ready";
}
