// Pure, container-free helpers for the search worker. Kept out of index.ts and the Container class so
// the unit tests can import them in the default node pool — importing the Container class pulls in
// `cloudflare:workers`, which that pool cannot resolve (and the Tantivy container cannot run locally
// either).

// The non-routable host the engine addresses its split reads and writes to. It never resolves on the
// public internet: SearchIndexContainer.outboundByHost intercepts it and this module forwards it to the
// app Worker, which mounts the real surface. It MUST stay in sync with the app Worker's
// `SPLIT_OBJECT_HOST` (apps/api-worker/src/search/split-object-host.ts) — change one and change the other in
// the same commit, or the engine's reads leave the container and are refused as egress.
export const SPLIT_OBJECT_HOST = "splits.magna-carta.internal";

// The engine's intercepted object call, forwarded to the app Worker over the service binding —
// verbatim, including method, headers, body, and the `Range` header that makes it a ranged read rather
// than a whole-object fetch. Nothing is added, nothing is stripped, nothing is retried, and nothing is
// cached here: the engine's read count is the platform's R2 cost, so a request the engine did not make
// must never originate in this hop, and a request it did make must never be widened.
//
// The forward carries no trust. The capability token the app Worker verifies rides in the engine's own
// headers; this worker neither mints nor inspects it, so a forged or expired one still fails on the far
// side rather than being laundered by having passed through here.
export function forwardSplitObjectCall(request: Request, appWorker: Fetcher): Promise<Response> {
  return appWorker.fetch(request);
}
