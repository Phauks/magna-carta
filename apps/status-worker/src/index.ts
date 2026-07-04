import {
  mergeSnapshot,
  parseAuthored,
  parseDerived,
  STATUS_KV_KEYS,
  type PublishedSnapshot,
} from "@magna-carta/status";
import { renderStatusPage } from "./render-status-page.ts";

export type Bindings = {
  STATUS_KV: KVNamespace;
};

const STALENESS_THRESHOLD_MS = 20 * 60 * 1000; // 20 min: twice the 10-min derived cron cadence

async function publicSnapshot(env: Bindings, now: string): Promise<PublishedSnapshot> {
  const [derivedText, authoredText] = await Promise.all([
    env.STATUS_KV.get(STATUS_KV_KEYS.derived),
    env.STATUS_KV.get(STATUS_KV_KEYS.authored),
  ]);
  return mergeSnapshot(parseDerived(derivedText, now), parseAuthored(authoredText, now), {
    audience: "public",
    now,
    stalenessThresholdMs: STALENESS_THRESHOLD_MS,
  });
}

const FALLBACK_HTML =
  "<!doctype html><meta charset=utf-8><title>Service status</title>" +
  "<p>The status system is temporarily unavailable. See the Cloudflare status page at " +
  '<a href="https://www.cloudflarestatus.com/">cloudflarestatus.com</a>.</p>';

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    try {
      const url = new URL(request.url);
      const now = new Date().toISOString();
      if (url.pathname === "/api/status.json") {
        return Response.json(await publicSnapshot(env, now), {
          headers: { "cache-control": "public, max-age=30", "x-robots-tag": "all" },
        });
      }
      if (url.pathname === "/" || url.pathname === "") {
        // Server-rendered from the same merged snapshot as the feed; readable with zero
        // JavaScript (a meta refresh keeps it current), so it works when everything else is down.
        const html = renderStatusPage(await publicSnapshot(env, now), { now });
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=30",
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    } catch {
      // Never surface a 500 on the public status path.
      return new Response(FALLBACK_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
} satisfies ExportedHandler<Bindings>;
