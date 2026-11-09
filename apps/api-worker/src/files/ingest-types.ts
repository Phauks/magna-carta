// The one name a member's re-scan request and the ingest consumer both spell: the audit action the
// request is keyed on. Its own module so the route (the HTTP side) and the consumer (the background
// side) share it without either importing the other.
// The action a member's "re-run the safety check" request enqueues. Unlike the access-triggered and
// per-matter re-scans, it is not gated on engine staleness and does not reuse the dedup cache: the
// member asked for the engine to look at these bytes again, so the engine looks at these bytes again.
export const FILE_RESCAN_ACTION = "FileRescan";
