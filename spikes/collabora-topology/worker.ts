// Throwaway spike Worker: a per-document Durable Object that owns one isolated Collabora container,
// instrumented to measure RSS, cold-start, and whether an alarm-driven keep-alive defeats the
// cloudflare/containers#147 activity-timeout sleep. Discarded after measurement.
//
// Toggles (wrangler vars, flipped + redeployed between the control and mitigation runs):
//   KEEP_ALIVE = "on" | "off"   — arm the alarm keep-alive (off = the #147 control)
//   SLEEP_AFTER = e.g. "60s"     — short, to hit the activity timeout fast
//
// Logs carry timestamps + lifecycle events only (no document bytes).

import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  DOCUMENT_SESSION: DurableObjectNamespace<DocumentSession>;
  KEEP_ALIVE?: string;
  SLEEP_AFTER?: string;
}

export class DocumentSession extends Container<Env> {
  defaultPort = 9980; // coolwsd (TLS terminated at the edge; the container speaks http on 9980)
  sleepAfter: string | number = "60s";

  private static readonly KEEP_ALIVE_SECONDS = 30; // < sleepAfter, so a renew always lands first

  override async onStart(): Promise<void> {
    if (this.env.SLEEP_AFTER) this.sleepAfter = this.env.SLEEP_AFTER;
    console.log(JSON.stringify({ evt: "container.onStart", ts: Date.now() }));
    if (this.env.KEEP_ALIVE !== "off") {
      await this.schedule(DocumentSession.KEEP_ALIVE_SECONDS, "keepAlive");
    }
  }

  override async onStop(params: { exitCode: number; reason: string }): Promise<void> {
    console.log(JSON.stringify({ evt: "container.onStop", ts: Date.now(), ...params }));
  }

  override async onActivityExpired(): Promise<void> {
    console.log(JSON.stringify({ evt: "container.onActivityExpired", ts: Date.now() }));
    return super.onActivityExpired();
  }

  // Alarm-driven keep-alive (the #147 mitigation under test): the DO's JS does not run per WebSocket
  // frame, so liveness is renewed on a timer, not on editor traffic. Re-arms for the session's life.
  async keepAlive(): Promise<void> {
    if (this.env.KEEP_ALIVE === "off") return;
    this.renewActivityTimeout();
    console.log(JSON.stringify({ evt: "keepAlive.renew", ts: Date.now() }));
    await this.schedule(DocumentSession.KEEP_ALIVE_SECONDS, "keepAlive");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One container for the whole spike (the production topology is one-per-document; the spike
    // measures coolwsd's per-kit behaviour inside a single instance). All requests → coolwsd on 9980
    // (HTTP + WebSocket; the WebSocket upgrade must go through the DO's fetch).
    const stub = getContainer(env.DOCUMENT_SESSION, "spike");
    return stub.fetch(request);
  },
};
