import { mergeSnapshot, parseAuthored, parseDerived, STATUS_KV_KEYS } from "@magna-carta/status";

export type Bindings = {
  STATUS_KV: KVNamespace;
};

const STALENESS_THRESHOLD_MS = 20 * 60 * 1000; // 20 min: twice the 10-min derived cron cadence

async function publicSnapshotJson(env: Bindings): Promise<Response> {
  const now = new Date().toISOString();
  const [derivedText, authoredText] = await Promise.all([
    env.STATUS_KV.get(STATUS_KV_KEYS.derived),
    env.STATUS_KV.get(STATUS_KV_KEYS.authored),
  ]);
  const published = mergeSnapshot(
    parseDerived(derivedText, now),
    parseAuthored(authoredText, now),
    {
      audience: "public",
      now,
      stalenessThresholdMs: STALENESS_THRESHOLD_MS,
    },
  );
  return Response.json(published, {
    headers: { "cache-control": "public, max-age=30", "x-robots-tag": "all" },
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
      if (url.pathname === "/api/status.json") return await publicSnapshotJson(env);
      if (url.pathname === "/" || url.pathname === "") {
        // HTML page is deferred; serve the machine feed's summary as a minimal placeholder.
        const json = await (await publicSnapshotJson(env)).json();
        return new Response(
          `<!doctype html><meta charset=utf-8><title>Service status</title><pre>${JSON.stringify(json, null, 2)}</pre>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
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
