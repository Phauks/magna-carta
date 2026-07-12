// A transport failure reaching an upstream registry service — the IANA bootstrap document or an RDAP
// server — as distinct from a fact about a registration. The bootstrap returning a non-200 is NOT
// "this TLD has no RDAP"; conflating the two turned an IANA outage into a bogus port-43 attempt (and
// a 500) for every .com lookup. The route maps this to a 503 the caller can retry, never a fallback.
export class WhoisTransportError extends Error {
  readonly upstreamUrl: string;
  readonly upstreamStatus?: number;

  constructor(upstreamUrl: string, upstreamStatus?: number) {
    super(
      `WHOIS upstream request to ${JSON.stringify(upstreamUrl)} failed` +
        (upstreamStatus === undefined ? "" : ` with status ${upstreamStatus}`),
    );
    this.name = "WhoisTransportError";
    this.upstreamUrl = upstreamUrl;
    this.upstreamStatus = upstreamStatus;
  }
}
