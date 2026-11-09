// THE SOURCE HOST — the build container's only way to the internet.
//
// The build container has no internet (enableInternet = false). It fetches the OpenAddresses source
// list and each source's output by calling a host that does not exist on any network; the build
// container's outbound interception (src/address-build-container.ts) hands each call to this module,
// which fetches the real URL from inside the Workers runtime and streams the answer back.
//
// An allow-list of exactly two shapes, and nothing else. Everything the engine could otherwise ask for
// — another host, another path, a query string, a method other than GET — is a 404 here, so the
// container's reach to the outside world is these two URLs and is written down in one place. No header
// from the container is forwarded: each upstream request is built fresh, so nothing the container
// says about itself leaves the platform.
//
// Pure: the fetch is handed in, so the tests run against a recording fake.

// The non-routable host the engine addresses its source calls to. It MUST stay in sync with the
// container's own constant (containers/address) — change one and change the other in the same commit.
export const ADDRESS_SOURCE_HOST = "openaddresses.magna-carta.internal";

// The anonymous source list: every source OpenAddresses carries, with its layer, licence and the job
// whose output is the current one.
export const SOURCE_LIST_URL = "https://batch.openaddresses.io/api/data";

// One source's output. The upstream answers with a redirect to a presigned object, which is followed
// here so the container sees one response.
export function sourceOutputUrl(job: string): string {
  return `https://v2.openaddresses.io/batch-prod/job/${job}/source.geojson.gz`;
}

// A job number as the source list carries it. Bounded so a path cannot carry an unbounded digit run.
const SOURCE_OUTPUT_PATH = /^\/job\/(\d{1,12})\/source\.geojson\.gz$/;

// The upstream URL an intercepted call maps to, or null when it is not one of the two shapes.
export function upstreamUrlOf(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.search !== "") return null;
  if (url.pathname === "/api/data") return SOURCE_LIST_URL;
  const match = SOURCE_OUTPUT_PATH.exec(url.pathname);
  return match === null ? null : sourceOutputUrl(match[1] as string);
}

export type SourceFetch = (input: string, init: RequestInit) => Promise<Response>;

// The headers worth passing back. The body is the product; these say how long it is and what it is.
const RETURNED_HEADERS = ["content-type", "content-length", "last-modified", "etag"];

// Serve one intercepted source call: fetch the one upstream URL it maps to, following redirects, and
// stream the body back unbuffered — a source's output can be hundreds of megabytes, and the build
// container reads it line by line as it arrives. The upstream status is passed through, so a missing
// job is the build's to handle as a skipped source.
export async function serveSourceCall(request: Request, fetcher: SourceFetch): Promise<Response> {
  const upstreamUrl = upstreamUrlOf(request);
  if (upstreamUrl === null) return Response.json({ error: "not-found" }, { status: 404 });
  const upstream = await fetcher(upstreamUrl, {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": "magna-carta-address-build" },
    signal: request.signal,
  });
  const headers = new Headers();
  for (const name of RETURNED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // A content-encoded answer is decoded by the runtime's fetch, so its declared length is the encoded
  // one and would be a lie about the body that actually arrives. The output today is a plain
  // application/gzip object with no content-encoding; this only keeps a change upstream from turning
  // into a truncated read.
  if (upstream.headers.has("content-encoding")) headers.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers });
}
