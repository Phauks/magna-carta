// The caller-identity port over Telnyx Number Lookup.
//
// ONE REQUEST, TWO ANSWERS. `GET /v2/number_lookup/{E.164}` takes `type` more than once, so the
// caller name and the carrier record arrive together and are billed as the two queries they are
// (the carrier query is the cheaper of the two and is what says mobile or landline). The enhanced
// and caller-identity types are deliberately not asked for: they cost several times as much, and
// the person deciding whether to pay is the one who pressed the button, not this adapter.
// Reference: https://developers.telnyx.com/api-reference/number-lookup/lookup-phone-number-data
//
// WHAT IS SENT is the number and nothing else. No name, no matter, no firm — Telnyx learns that
// somebody asked about a number, which is the disclosure the owner accepted when the lookup was
// switched on, and nothing the firm holds about the person rides along with it.
//
// THE TRANSPORT IS INJECTED, so a test drives the adapter with a canned answer and the Worker hands
// in its own fetch. Nothing here reads `env`.
import {
  callerNameCovered,
  type CallerIdentity,
  type CallerLineType,
  type CallerLookupOutcome,
  type CallerLookupPort,
  type CallerNumber,
} from "./port.ts";

export interface TelnyxCredentials {
  readonly apiKey: string;
}

const NUMBER_LOOKUP_URL = "https://api.telnyx.com/v2/number_lookup/";

// Telnyx's line types, mapped onto the product's. Anything not named here is a real line type this
// product has no use for distinguishing (pager, premium rate, shared cost, …) and reads as `other`.
const LINE_TYPES: Readonly<Record<string, CallerLineType>> = {
  mobile: "mobile",
  "fixed line": "fixed",
  "fixed line or mobile": "fixedOrMobile",
  voip: "voip",
  "toll free": "tollFree",
};

interface TelnyxLookupBody {
  readonly data?: {
    readonly caller_name?: { readonly caller_name?: unknown } | null;
    readonly carrier?: { readonly name?: unknown; readonly type?: unknown } | null;
  };
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function lineTypeOf(value: unknown): CallerLineType | null {
  const text = textOrNull(value)?.toLowerCase();
  if (text === undefined || text === "unknown") return null;
  return LINE_TYPES[text] ?? "other";
}

/** Reads the provider's body into the product's shape. Exported for its test. */
export function identityFromTelnyxBody(body: unknown): CallerIdentity | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as TelnyxLookupBody).data;
  if (typeof data !== "object" || data === null) return null;
  return {
    callerName: textOrNull(data.caller_name?.caller_name),
    lineType: lineTypeOf(data.carrier?.type),
    carrierName: textOrNull(data.carrier?.name),
  };
}

export function telnyxCallerLookupPort(
  credentials: TelnyxCredentials,
  transport: typeof fetch = fetch,
): CallerLookupPort {
  return {
    engine: "telnyx",
    async lookUp(number: CallerNumber): Promise<CallerLookupOutcome> {
      if (!callerNameCovered(number)) return { kind: "not-covered" };
      const e164 = `+${number.countryCallingCode}${number.nationalNumber}`;
      const url = `${NUMBER_LOOKUP_URL}${encodeURIComponent(e164)}?type=caller-name&type=carrier`;
      let response: Response;
      try {
        response = await transport(url, {
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            Accept: "application/json",
          },
        });
      } catch {
        return { kind: "failed", reason: "transport" };
      }
      if (!response.ok) return { kind: "failed", reason: "refused" };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "failed", reason: "malformed" };
      }
      const identity = identityFromTelnyxBody(body);
      return identity === null
        ? { kind: "failed", reason: "malformed" }
        : { kind: "found", identity };
    },
  };
}
