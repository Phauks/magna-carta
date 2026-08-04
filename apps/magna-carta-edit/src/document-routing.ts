// Pure, container-free helpers for the edit worker. Kept out of index.ts / the Container class so the
// unit tests can import them in the default node pool — importing the Container class would pull in
// `cloudflare:workers`, which that pool cannot resolve (coolwsd cannot run locally either).

// The shape of a document key: the app worker's editor-launch mints it as the leading 52 hex characters
// of the SHA-256 of the fileId, so a real key is exactly 52 lowercase hex characters and nothing else.
// The pattern is anchored and the length fixed, so the check is a total function of the label — the
// caller never has to reason about which characters a container name will tolerate. Any change to how
// the launch derives the key must change this pattern in the same commit (the app worker's
// apps/worker/src/editing/edit-session-route.ts derives it).
const DOCUMENT_KEY_PATTERN = /^[0-9a-f]{52}$/;

// The per-document container key — the first label of the Host. The editor is served on a cookieless
// wildcard origin (`<key>.edit.<domain>`), so every request for one document (cool.html, static assets,
// the WebSocket) carries the same label and pins to one isolated coolwsd container. The key is a stable,
// opaque per-document token the app worker's editor-launch derives from the fileId (stable so co-editors
// converge, opaque so the origin leaks no fileId).
//
// The label is validated against the minted shape BEFORE it can name a container, and null (a cheap 404
// at the caller) is the answer for anything else. Every container is a multi-gigabyte coolwsd instance
// started on first address, so an unvalidated label lets any request with an invented Host boot one:
// the check keeps that cost reachable only through keys this platform actually minted. It is not an
// authorization check — the WOPI access token remains the only thing that authorizes a document — so a
// well-formed key for a document the caller may not read still gets them nothing.
export function documentKeyFromHost(host: string): string | null {
  const label = (host.split(":")[0] ?? "").split(".")[0]?.trim() ?? "";
  return DOCUMENT_KEY_PATTERN.test(label) ? label : null;
}

// coolwsd's intercepted WOPI callback, forwarded to the app worker over the service binding — verbatim,
// including method, headers, and body. The container has no general egress; this is the one host it can
// reach, and only because the Workers runtime intercepts it (see DocumentEditorContainer.outboundByHost).
export function forwardWopiCallback(request: Request, appWorker: Fetcher): Promise<Response> {
  return appWorker.fetch(request);
}
