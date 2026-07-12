import { assertPublicTarget } from "@magna-carta/integrations/safe-target";
import type { RegistrationResult, WhoisDeps } from "./types.ts";
import { resolveRdapBase, queryRdap } from "./rdap.ts";
import { queryLegacy } from "./legacy.ts";
import { WhoisTransportError } from "./errors.ts";

/**
 * Looks up the registration record for a domain name or IP address.
 *
 * The query is first normalized and validated through the SSRF guard
 * (`assertPublicTarget`), which rejects private, loopback, link-local, and
 * reserved addresses — throwing `SsrfRejection` for any non-public target.
 *
 * After the target is confirmed public, the IANA bootstrap registry is consulted for an authoritative
 * RDAP base URL. The bootstrap answers with one of three distinct outcomes, each handled differently:
 *
 *   - `found`            → query the RDAP server and return the structured result.
 *   - `noRdapForTld`     → the TLD genuinely has no RDAP server; fall through to a port-43 WHOIS query.
 *   - `transportFailure` → the bootstrap fetch itself failed; surface a `WhoisTransportError` rather
 *                          than misread the failure as "no RDAP" and attempt a port-43 lookup that
 *                          throws for every TLD outside the small static table.
 *
 * All outbound effects go through `deps` — no global `fetch` or socket calls.
 */
export async function lookupRegistration(
  query: string,
  deps: WhoisDeps,
): Promise<RegistrationResult> {
  const parsed = await assertPublicTarget(query, deps.resolve);
  const target = parsed.host;

  const now = deps.now ?? (() => new Date().toISOString());
  const retrievedAt = now();

  const resolution = await resolveRdapBase(target, deps.http);

  switch (resolution.outcome) {
    case "found":
      return queryRdap(target, resolution.base, deps.http, retrievedAt);
    case "noRdapForTld":
      return queryLegacy(target, deps.socket, retrievedAt);
    case "transportFailure":
      throw new WhoisTransportError(resolution.url, resolution.status);
  }
}
