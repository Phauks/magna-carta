/*
 * WHOIS lookup — the fetch-and-classify seam for the WHOIS Lookup page. The branching that decides
 * which of the page's states to show lives here, out of the component, so it is unit-testable
 * without a DOM (see apps/web/test/whois-lookup.test.ts).
 *
 * The registration endpoint answers over the same-origin API. apps/web does not depend on
 * @magna-carta/api-client (adopting it is a scope decision the owner has not made), so this calls
 * the relative route with a raw same-origin fetch, matching the speed-test page's approach in
 * apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts.
 *
 * WhoisResult mirrors the generated WhoisResponse in packages/api-client/src/types.gen.ts; move to
 * that generated type when apps/web adopts the client.
 */

export interface WhoisResult {
  source: "rdap" | "whois-43";
  target: string;
  registrar?: string;
  registeredAt?: string;
  expiresAt?: string;
  lastChangedAt?: string;
  nameservers?: string[];
  statuses?: string[];
  registrant?: string;
  raw?: string;
}

// A failed lookup surfaced to the user. `errorId` is the user-facing correlation handle carried on
// every RFC 9457 problem document — the platform mints one even on a 500 — so a member can quote it
// to support and it maps to the redacted server trace (the standard error pipeline in
// docs/conventions/error-logging.md).
export interface WhoisProblem {
  status: number;
  errorId?: string;
}

// The distinct states a lookup resolves to. `rdap`/`raw`/`empty` share a body; the component
// discriminates on the exact kind to pick structured card, raw block, or "nothing found" notice.
export type WhoisOutcome =
  | { kind: "rdap" | "raw" | "empty"; result: WhoisResult }
  | { kind: "problem"; problem: WhoisProblem }
  | { kind: "transport" };

export type ProblemTone = "info" | "warning" | "danger";

export interface ProblemGuidance {
  tone: ProblemTone;
  title: string;
  message: string;
}

const WHOIS_ENDPOINT = "/api/v1/whois";

/**
 * Whether an RDAP result carries any registration field worth showing. A non-existent domain does
 * NOT error under RDAP — it returns `source: "rdap"` with every field empty — so this is how a
 * found record is told apart from a blank one. An empty array counts as absent.
 */
export function hasRegistrationDetail(result: WhoisResult): boolean {
  return Boolean(
    result.registrar ||
    result.registeredAt ||
    result.expiresAt ||
    result.lastChangedAt ||
    result.registrant ||
    (result.nameservers && result.nameservers.length > 0) ||
    (result.statuses && result.statuses.length > 0),
  );
}

/**
 * Classify a 200 body into the state the page renders. The legacy port-43 path always returns
 * unparsed `raw` text; RDAP returns structure, or nothing at all for an unregistered target.
 */
export function classifyResult(result: WhoisResult): "rdap" | "raw" | "empty" {
  if (result.source === "whois-43") return "raw";
  return hasRegistrationDetail(result) ? "rdap" : "empty";
}

/**
 * Human guidance for a failed lookup, keyed by HTTP status. Deliberately never echoes the query or
 * any resolved address: the 400 is generic on purpose — the worker route
 * (apps/api-worker/src/routes/whois.ts) keeps it that way as an SSRF guard, and the UI must not undo
 * that by reflecting the input back. A server fault (>= 500) is the case that carries an Error ID
 * for the member to quote.
 */
export function problemGuidance(problem: WhoisProblem): ProblemGuidance {
  // 501 is checked before the server-fault band it sits in: the registry simply publishes no
  // machine-readable lookup (no RDAP entry, no known port-43 host), which is the ordinary answer
  // for roughly a sixth of the TLD list. Nothing went wrong, so nothing is worth quoting to support.
  if (problem.status === 501) {
    return {
      tone: "info",
      title: "This registry cannot be looked up",
      message:
        "That domain's registry does not publish a lookup service this tool can reach. Check the registry's own WHOIS page directly.",
    };
  }
  if (problem.status >= 500) {
    return {
      tone: "danger",
      title: "The lookup failed",
      message: "Something went wrong on our side. Quote the Error ID below to support.",
    };
  }
  switch (problem.status) {
    case 401:
      return {
        tone: "info",
        title: "You are not signed in",
        message:
          "WHOIS lookups run against an authenticated session. In local development there is no session yet, so the lookup returns nothing.",
      };
    case 403:
      return {
        tone: "warning",
        title: "You do not have permission",
        message: "Your account is not allowed to run WHOIS lookups.",
      };
    case 429:
      return {
        tone: "warning",
        title: "Too many lookups",
        message: "You have run several lookups in a short time. Wait a moment, then try again.",
      };
    default:
      // 400 (invalid/blocked target) and 422 (the query failed validation) — both are input faults.
      return {
        tone: "warning",
        title: "That is not something this tool can look up",
        message:
          "Enter a domain name (example.com) or an IP address. Private, local, and internal addresses are not accepted.",
      };
  }
}

/**
 * Format an ISO 8601 timestamp for display. An unparseable value is returned unchanged rather than
 * hidden — showing exactly what the registry sent is more honest than dropping a field we could not
 * parse.
 */
export function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Read the correlation handle off a problem document. Defensive: a body that is not JSON, or is
// missing the field, still yields a usable problem carrying the HTTP status.
async function readProblem(response: Response): Promise<WhoisProblem> {
  try {
    const body = (await response.json()) as { errorId?: unknown };
    return {
      status: response.status,
      errorId: typeof body.errorId === "string" ? body.errorId : undefined,
    };
  } catch {
    return { status: response.status };
  }
}

/**
 * Run a WHOIS lookup for a domain or IP. `fetchImpl` is injectable so the branching is testable
 * without the network. Never throws: a thrown fetch (nothing answered) is reported as `transport`,
 * distinct from a server that answered with an error document.
 */
export async function lookupWhois(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WhoisOutcome> {
  const target = query.trim();
  const url = `${WHOIS_ENDPOINT}?query=${encodeURIComponent(target)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return { kind: "transport" };
  }

  if (!response.ok) {
    return { kind: "problem", problem: await readProblem(response) };
  }

  let result: WhoisResult;
  try {
    result = (await response.json()) as WhoisResult;
  } catch {
    return { kind: "transport" };
  }

  return { kind: classifyResult(result), result };
}
