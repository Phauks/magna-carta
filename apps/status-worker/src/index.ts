import { isVersionRequest, versionResponse } from "@magna-carta/build-identity/version-route";
import {
  mergeSnapshot,
  parseAuthored,
  parseDerived,
  parseHistory,
  STATUS_KV_KEYS,
  type PublishedSnapshot,
} from "@magna-carta/status";
import atkinsonLatinWoff2 from "./assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2";
import { FONT_ASSET_PATH, PAGE_CSS, STYLES_ASSET_PATH } from "./page-styles.ts";
import { renderStatusPage } from "./render-status-page.ts";

export type Bindings = {
  STATUS_KV: KVNamespace;
};

const STALENESS_THRESHOLD_MS = 20 * 60 * 1000; // 20 min: twice the 10-min derived cron cadence

// Both /assets responses are immutable for a year: the stylesheet path is content-hashed (a CSS
// change mints a new URL), and the font file is a fixed artifact renamed if ever replaced. The
// meta-refreshed HTML is the only thing a reader refetches every minute.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

// The page and the feed are the same snapshot in two renderings, and both are identical for every
// reader — there is no session, no cookie, no per-firm content anywhere on this worker — so the
// edge may hold them. 30 seconds bounds how stale a reader's answer can be; the 600-second
// stale-while-revalidate window is what an incident is actually for: when this worker's KV read
// starts failing, the edge keeps handing out the last good page while a background revalidation
// retries, instead of every reader immediately falling through to FALLBACK_HTML.
const SNAPSHOT_CACHE = "public, max-age=30, stale-while-revalidate=600";

// Anything whose body is NOT a real snapshot must be stored by nobody. This is not belt-and-braces:
// with the edge cache enabled, a response carrying no Cache-Control is cached anyway under RFC 9111
// heuristic freshness — a 200 for two hours, a 404 for three minutes, a 405 for one. The fallback
// below is a 200. Without this header, one transient KV failure would pin "the status system is
// temporarily unavailable" at the edge for two hours, on the one page that exists to be truthful
// during an incident. Rules: docs/conventions/security.md (response cache-control).
const NEVER_CACHE = "no-store";

// Purge-by-tag is scoped to the worker that issues the purge, and every writer of this data lives in
// a different worker (the cron and the operator endpoints in apps/api-worker), so nothing can purge these
// entries today — a published incident becomes visible when the 30-second window lapses. Tagging the
// responses now costs nothing and is what a future purge path would need: it would be a route on
// THIS worker calling ctx.cache.purge({ tags: ["status-snapshot"] }). Tags must be ASCII and
// space-free; an invalid tag is silently dropped at storage time, so they are written as literals.
const PAGE_CACHE_TAGS = "status-snapshot,status-page";
const FEED_CACHE_TAGS = "status-snapshot,status-feed";

async function publicSnapshot(env: Bindings, now: string): Promise<PublishedSnapshot> {
  const [derivedText, authoredText, historyText] = await Promise.all([
    env.STATUS_KV.get(STATUS_KV_KEYS.derived),
    env.STATUS_KV.get(STATUS_KV_KEYS.authored),
    env.STATUS_KV.get(STATUS_KV_KEYS.history),
  ]);
  return mergeSnapshot(
    parseDerived(derivedText, now),
    parseAuthored(authoredText, now),
    parseHistory(historyText, now),
    { audience: "public", now, stalenessThresholdMs: STALENESS_THRESHOLD_MS },
  );
}

const FALLBACK_HTML =
  "<!doctype html><meta charset=utf-8><title>Magna Carta Status</title>" +
  "<p>The status system is temporarily unavailable. See the Cloudflare status page at " +
  '<a href="https://new.cloudflarestatus.com/">new.cloudflarestatus.com</a>.</p>';

// Named (rather than inlined in the catch) so its headers are directly assertable: a KV failure
// cannot be provoked through the test pool, and the one thing that must never regress here is that
// this stand-in is not storable by the edge cache.
export function fallbackResponse(): Response {
  return new Response(FALLBACK_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": NEVER_CACHE },
  });
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "cache-control": NEVER_CACHE },
      });
    }
    try {
      const url = new URL(request.url);
      // The build-identity read the app worker's aggregate version endpoint probes over
      // STATUS_SERVICE. This worker is publicly routable, so the answer — a build commit and two
      // timestamps — is readable by anyone; that is the same disclosure the page itself makes by
      // existing (a public status page's build identity is operational, not privileged), and the
      // web app already shows its own commit to signed-out visitors. Never cached: a version read
      // pinned at the edge would misreport a fresh deploy for as long as the cache held it.
      if (isVersionRequest(request)) {
        const response = versionResponse();
        response.headers.set("cache-control", NEVER_CACHE);
        return response;
      }
      const now = new Date().toISOString();
      if (url.pathname === "/api/status.json") {
        return Response.json(await publicSnapshot(env, now), {
          headers: {
            "cache-control": SNAPSHOT_CACHE,
            "cache-tag": FEED_CACHE_TAGS,
            "x-robots-tag": "all",
          },
        });
      }
      // The page's only assets, served by this same worker (nothing external, fate-isolated).
      if (url.pathname === STYLES_ASSET_PATH) {
        return new Response(PAGE_CSS, {
          headers: { "content-type": "text/css; charset=utf-8", "cache-control": IMMUTABLE_CACHE },
        });
      }
      if (url.pathname === FONT_ASSET_PATH) {
        return new Response(atkinsonLatinWoff2, {
          headers: { "content-type": "font/woff2", "cache-control": IMMUTABLE_CACHE },
        });
      }
      if (url.pathname === "/" || url.pathname === "") {
        // Server-rendered from the same merged snapshot as the feed; readable with zero
        // JavaScript (a meta refresh keeps it current), so it works when everything else is down.
        const html = renderStatusPage(await publicSnapshot(env, now), { now });
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": SNAPSHOT_CACHE,
            "cache-tag": PAGE_CACHE_TAGS,
          },
        });
      }
      return new Response("Not Found", { status: 404, headers: { "cache-control": NEVER_CACHE } });
    } catch {
      // Never surface a 500 on the public status path — and never let this stand-in outlive the
      // failure that produced it (see NEVER_CACHE).
      return fallbackResponse();
    }
  },
} satisfies ExportedHandler<Bindings>;
