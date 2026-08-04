// The custody-number shape: an optional firm prefix, an optional location code, and a zero-padded
// sequence — CUS-00042, or RNO-00042 for a firm that scopes numbering per custody root.
//
// This is deliberately NOT the matters segment-template engine. Matter numbers carry strong,
// established, court-visible firm conventions and earn a full template engine with its own scheme
// table and editor; custody numbers carry no such weight — they are what a person writes on a label
// and reads over the phone. Configuring a fixed shape through the scoped-settings mechanism is the
// whole requirement, and building a second template engine on speculation would be building the same
// thing twice. If a firm ever does need the full engine here, the matters renderer is extracted into
// a shared module — a small change made against a real need.

export interface CustodyNumberScheme {
  readonly prefix?: string; // a firm-wide label, e.g. "CUS"
  readonly padWidth: number; // zero-padding on the sequence
  readonly startValue: number; // the first value the counter hands out
  // When true, each custody root gets its own counter, so RNO-00042 and LVS-00042 coexist. The
  // default is firm-wide: a globally unique custody number is easier to say over the phone and
  // impossible to confuse.
  readonly scopeByRoot?: boolean;
}

export const DEFAULT_CUSTODY_NUMBER_SCHEME: CustodyNumberScheme = {
  prefix: "CUS",
  padWidth: 5,
  startValue: 1,
  scopeByRoot: false,
};

export interface CustodyNumberContext {
  // The code of the custody root the packet is being logged into — used only when the scheme scopes
  // per root. Absent means the packet is not (yet) under a root, which is a firm-wide draw.
  readonly rootCode?: string;
}

// Fold to URL-safe: a custody number appears in a path segment and on a printed label, so anything
// outside the unreserved set is stripped rather than escaped.
function sanitizeUrlSafe(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9._~-]/g, "");
}

// The scope key is what the counter row is keyed by. Empty string is the firm-wide scope — the
// default, and the value every firm-wide draw shares.
export function deriveScopeKey(
  scheme: CustodyNumberScheme,
  context: CustodyNumberContext = {},
): string {
  if (scheme.scopeByRoot !== true) return "";
  return sanitizeUrlSafe(context.rootCode ?? "");
}

export function renderCustodyNumber(
  scheme: CustodyNumberScheme,
  context: CustodyNumberContext,
  counterValue: number,
): string {
  const parts: string[] = [];
  const prefix = sanitizeUrlSafe(scheme.prefix ?? "");
  if (prefix.length > 0) parts.push(prefix);
  if (scheme.scopeByRoot === true) {
    const rootCode = sanitizeUrlSafe(context.rootCode ?? "");
    if (rootCode.length > 0) parts.push(rootCode);
  }
  parts.push(String(counterValue).padStart(Math.max(1, scheme.padWidth), "0"));
  return parts.join("-");
}

// An item's number is packet-relative — CUS-00042-3 — derived from its ordinal within the packet
// rather than drawn from a counter. An item's identity is only meaningful inside its packet, so a
// second global counter would buy nothing and would be a second race to get right.
export function renderCustodyItemNumber(packetNumber: string, ordinal: number): string {
  return `${packetNumber}-${ordinal}`;
}
