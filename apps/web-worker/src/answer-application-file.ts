// The one piece of work the interface Worker does, and only for paths under /_app/.
//
// Every file SvelteKit emits under /_app/immutable/ carries a hash of its own content in its name, so
// its bytes can never change and a browser may keep it for a year without asking again. The asset
// server's default is the opposite: `max-age=0, must-revalidate`, which had a returning reader's
// browser re-ask about each of roughly 116 files (a 304 each) before the application could start.
//
// The long lifetime cannot be granted by a `_headers` rule alone, because of what the asset server
// does with a file that is NOT there. This Worker serves a client-routed application, so a path that
// matches no file is answered with the application shell and a 200 — which is right for /matters/123
// and wrong for /_app/immutable/chunks/abc.js. A browser that asks for a chunk in the seconds a deploy
// is still spreading, or from a tab opened before one, would receive HTML with a 200, and a header
// rule keyed on the path would tell it to keep that HTML under the script's address for a year. The
// reader's application would then fail to start until they cleared their cache.
//
// So the two halves live together, here: a missing file under /_app/ is a 404 that nothing may store,
// and only a response that really is the file gets the long lifetime. Everything outside /_app/ never
// reaches this code — the asset server answers it directly (`run_worker_first` in wrangler.jsonc).

/** The asset server, as this Worker sees it. Nothing else is bound, and nothing else should be. */
export interface Bindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const APPLICATION_FILES_PREFIX = "/_app/";
const IMMUTABLE_PREFIX = "/_app/immutable/";

/** One year, the longest lifetime browsers honour, and never revalidated within it. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// The statuses that carry (or confirm) the file itself: the whole file, a byte range of it, and "the
// copy you hold is current". Anything else — a redirect, an error — keeps the header it came with.
const FILE_STATUSES = new Set([200, 206, 304]);

const isApplicationShell = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");

/**
 * Answer a request for one of the application's own files.
 *
 * Nothing under /_app/ is an HTML document, so HTML coming back for such a path can only be the
 * shell standing in for a file that does not exist.
 */
export async function answerApplicationFile(
  request: Request,
  assets: Bindings["ASSETS"],
): Promise<Response> {
  const response = await assets.fetch(request);
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(APPLICATION_FILES_PREFIX)) return response;

  if (isApplicationShell(response)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (pathname.startsWith(IMMUTABLE_PREFIX) && FILE_STATUSES.has(response.status)) {
    // The asset server's response headers are immutable, so the response is rebuilt around the same
    // body (a stream, passed through, never buffered).
    const withLifetime = new Response(response.body, response);
    withLifetime.headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
    return withLifetime;
  }

  return response;
}
