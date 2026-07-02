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
 * Performs a port-43 WHOIS query for `target` using the injected `WhoisSocket`.
 *
 * The TLD is derived from the rightmost label of `target`. If no port-43 host is
 * known for that TLD, an error is thrown — the caller should ensure that
 * `whoisHostForTld` returns a non-null value before calling this function, or
 * handle the error appropriately.
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
    throw new Error(
      `No port-43 WHOIS host is known for TLD "${tld}" (target: "${target}"). ` +
        `Add it to the WHOIS_HOSTS table in src/legacy.ts if a registry host exists.`,
    );
  }

  const raw = await socket.query(host, target + "\r\n");
  return { source: "whois-43", target, raw };
}
