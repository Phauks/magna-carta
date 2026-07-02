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
    return queryRdap(target, rdapBase, deps.http);
  }

  return queryLegacy(target, deps.socket);
}
