import { assertPublicTarget } from "@magna-carta/integrations/safe-target";
import type { RegistrationResult, WhoisDeps } from "./types.ts";
import { resolveRdapBase, queryRdap } from "./rdap.ts";
import { queryLegacy } from "./legacy.ts";

/**
 * Looks up the registration record for a domain name or IP address.
 *
 * The query is first normalized and validated through the SSRF guard
 * (`assertPublicTarget`), which rejects private, loopback, link-local, and
 * reserved addresses — throwing `SsrfRejection` for any non-public target.
 *
 * After the target is confirmed public, RDAP is attempted first: the IANA
 * bootstrap registry is consulted to find an authoritative RDAP base URL for
 * the TLD or IP block. If one is found, the RDAP server is queried and the
 * structured result is returned.
 *
 * When the bootstrap registry has no RDAP entry for the TLD (i.e.
 * `resolveRdapBase` returns `null`), the function falls back to a port-43
 * WHOIS query via the injected socket.
 *
 * All outbound effects go through `deps` — no global `fetch` or socket calls.
 */
export async function lookupRegistration(
  query: string,
  deps: WhoisDeps,
): Promise<RegistrationResult> {
  const parsed = await assertPublicTarget(query, deps.resolve);
  const target = parsed.host;

  const rdapBase = await resolveRdapBase(target, deps.http);
  if (rdapBase !== null) {
    let current = target;
    let result = await queryRdap(current, rdapBase, deps.http);
    // Registries hold REGISTRABLE domains, so a hostname query usually answers nothing:
    // "www.youtube.com" is a 404 at Verisign while "youtube.com" is the record the member meant.
    // Walk up one label at a time until something answers or only the registrable minimum
    // (two labels) is left. The walk stays inside the same TLD, so the resolved base holds; the
    // returned result's `target` names the domain that actually answered. IP targets never walk —
    // an address is its own registry subject. Only detail-less answers walk: a multi-label ccTLD
    // registrable ("a.co.uk") answers at its own level and the walk never fires.
    while (!hasAnyRegistrationDetail(result) && !looksLikeIpAddress(target)) {
      const parent = parentDomain(current);
      if (parent === null) break;
      current = parent;
      result = await queryRdap(current, rdapBase, deps.http);
    }
    return result;
  }

  return queryLegacy(target, deps.socket);
}

/** Whether an RDAP answer carries any registration field at all — the walk-up's stop condition. */
function hasAnyRegistrationDetail(result: RegistrationResult): boolean {
  return Boolean(
    result.registrar ||
    result.registrant ||
    result.registeredAt ||
    result.expiresAt ||
    result.lastChangedAt ||
    (result.nameservers && result.nameservers.length > 0) ||
    (result.statuses && result.statuses.length > 0),
  );
}

/** The name one label up ("www.youtube.com" -> "youtube.com"), or null at the two-label floor. */
function parentDomain(name: string): string | null {
  const labels = name.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : null;
}

/** Crude but sufficient here: dotted-quad IPv4 or anything with an IPv6 colon. */
function looksLikeIpAddress(host: string): boolean {
  if (host.includes(":")) return true;
  const labels = host.split(".");
  return labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label));
}
