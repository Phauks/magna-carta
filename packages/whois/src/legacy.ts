import type { RegistrationResult, WhoisSocket } from "./types.ts";

// Static table mapping ccTLD labels to their port-43 WHOIS hosts.
// These registries have not published RDAP endpoints and require the legacy protocol.
const WHOIS_HOSTS: Record<string, string> = {
  de: "whois.denic.de",
  eu: "whois.eu",
  nl: "whois.domain-registry.nl",
  fr: "whois.nic.fr",
  it: "whois.nic.it",
  be: "whois.dns.be",
};

/**
 * Returns the port-43 WHOIS host for the given TLD, or `null` if the TLD is
 * not in the static table (i.e. it has an RDAP endpoint or is simply unknown).
 */
export function whoisHostForTld(tld: string): string | null {
  return WHOIS_HOSTS[tld.toLowerCase()] ?? null;
}

/**
 * The queried registry publishes neither an RDAP service (it is absent from the IANA bootstrap)
 * nor a port-43 host this package knows. That is an ordinary and common outcome — roughly a sixth
 * of the IANA TLD list is in this position — so it is a typed refusal the route can turn into an
 * honest answer, never an unhandled throw that reaches a caller as an internal error.
 */
export class UnsupportedRegistry extends Error {
  readonly tld: string;

  constructor(tld: string) {
    super(`No registration service is known for the ".${tld}" registry.`);
    this.name = "UnsupportedRegistry";
    this.tld = tld;
  }
}

/**
 * Performs a port-43 WHOIS query for `target` using the injected `WhoisSocket`.
 *
 * The TLD is derived from the rightmost label of `target`. If no port-43 host is
 * known for that TLD, `UnsupportedRegistry` is thrown so the caller can answer that
 * the registry cannot be queried rather than reporting a server fault.
 *
 * Returns a `RegistrationResult` with `source: "whois-43"` and the unparsed
 * response text in `raw`. Structured fields (registrar, dates, etc.) are not
 * populated — callers that need parsed data must parse `raw` themselves.
 */
export async function queryLegacy(
  target: string,
  socket: WhoisSocket,
): Promise<RegistrationResult> {
  const tld = target.split(".").at(-1) ?? "";
  const host = whoisHostForTld(tld);

  if (host === null) {
    throw new UnsupportedRegistry(tld);
  }

  const raw = await socket.query(host, target + "\r\n");
  return { source: "whois-43", target, raw };
}
