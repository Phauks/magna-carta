import type { LegacyWhoisRecord, LookupProvenance, WhoisSocket } from "./types.ts";

// The ccTLD registries that still answer only on port 43 — verified against IANA's live bootstrap on
// 2026-07-09. `.nl` and `.fr` were removed that day: both now publish RDAP (rdap.sidn.nl, rdap.nic.fr)
// and reach this table only if the bootstrap fetch fails, in which case an RDAP transport failure is
// surfaced rather than a port-43 fallback (see lookup.ts). Only these four are genuinely port-43-only:
//
//   .de  whois.denic.de   two lines: Domain, Status. No dates, registrar, nameservers, contacts.
//   .eu  whois.eu         registrant "NOT DISCLOSED!", technical/registrar/nameservers. No dates.
//   .it  whois.nic.it     Status, DNSSEC, Created/Last-Update/Expire, full postal contacts, nameservers.
//   .be  whois.dns.be     tab-separated; Status: NOT AVAILABLE (means REGISTERED), dates without a zone.
const WHOIS_HOSTS: Record<string, string> = {
  de: "whois.denic.de",
  eu: "whois.eu",
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
 * The raw response text is returned verbatim and is NEVER parsed into the shared registration fields.
 * The four formats share no grammar, and normalising them would print falsehoods into a document
 * offered as evidence: DNS Belgium reports a REGISTERED domain as `Status: NOT AVAILABLE`, so mapping
 * that string into the shared status field would state the opposite of the truth. Their dates carry no
 * timezone (`.it` → `1997-08-27 00:00:00`; `.be` → `Wed Jun 13 2012`), so they cannot honestly be
 * converted to UTC. The result is therefore marked `timezoneUnspecified` and the page shows the text
 * as the registry published it — labelled as such — rather than guessing an instant.
 *
 * If no port-43 host is known for the target's TLD an error is thrown — the caller
 * (`lookupRegistration`) only reaches here after the bootstrap reported no RDAP server for the TLD.
 */
export async function queryLegacy(
  target: string,
  socket: WhoisSocket,
  retrievedAt: string,
): Promise<LegacyWhoisRecord> {
  const tld = target.split(".").at(-1) ?? "";
  const host = whoisHostForTld(tld);

  if (host === null) {
    throw new Error(
      `No port-43 WHOIS host is known for TLD "${tld}" (target: "${target}"). ` +
        `Add it to the WHOIS_HOSTS table in src/legacy.ts if a registry host exists.`,
    );
  }

  const raw = await socket.query(host, target + "\r\n");
  const provenance: LookupProvenance = { target, retrievedAt, respondingServer: host };
  return { kind: "legacy", source: "whois-43", provenance, raw, timezoneUnspecified: true };
}
