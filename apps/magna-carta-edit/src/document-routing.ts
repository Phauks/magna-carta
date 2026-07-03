// Pure, container-free helpers for the edit worker. Kept out of index.ts / the Container class so the
// unit tests can import them in the default node pool — importing the Container class would pull in
// `cloudflare:workers`, which that pool cannot resolve (coolwsd cannot run locally either).

// The per-document container key — the first label of the Host. The editor is served on a cookieless
// wildcard origin (`<key>.edit.<domain>`), so every request for one document (cool.html, static assets,
// the WebSocket) carries the same label and pins to one isolated coolwsd container. The key is a stable,
// opaque per-document token the app worker's editor-launch derives from the fileId (stable so co-editors
// converge, opaque so the origin leaks no fileId). Returns null when the host has no usable label.
export function documentKeyFromHost(host: string): string | null {
  const label = (host.split(":")[0] ?? "").split(".")[0]?.trim() ?? "";
  return label.length > 0 ? label : null;
}

// coolwsd's intercepted WOPI callback, forwarded to the app worker over the service binding — verbatim,
// including method, headers, and body. The container has no general egress; this is the one host it can
// reach, and only because the Workers runtime intercepts it (see DocumentEditorContainer.outboundByHost).
export function forwardWopiCallback(request: Request, appWorker: Fetcher): Promise<Response> {
  return appWorker.fetch(request);
}
