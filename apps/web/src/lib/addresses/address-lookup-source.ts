/*
 * Address lookup as the address form asks it — the ONE adapter between the Worker's two
 * address-lookup operations and the design system's `AddressLookup`, so every form that holds an
 * address offers the same addresses and words the same answers.
 *
 * The form never fetches; it takes a lookup. This is that lookup, over the generated client.
 *
 * A call that could not run is THROWN, not returned as an answer: the form turns a rejection into its
 * "did not answer" state, and a failed service must never look like an address nobody has. The
 * generated client already throws exactly that — an `ApiCallFailed` carrying the failure, reported on
 * its way out by the client's own interceptor ($lib/api/api-client.ts) — so nothing here catches. "No
 * service is provisioned" is different again: an answer, `unavailable`, on which the form quietly
 * stops asking and stays a plain text box.
 *
 * No abort signal is passed, deliberately, and the reason is the platform notice: an abandoned call
 * resolves as a failure nothing answered, every failure is counted toward the platform-wide notice,
 * and three inside a minute and a half announce that the platform is unwell. Typing an address
 * overtakes several searches in a few seconds. The form already discards an answer a newer question
 * has overtaken, so an unpassed signal costs a response nobody reads and nothing else.
 */
import {
  addressLookupResolve,
  addressLookupSuggest,
  type AddressLookupParts,
  type AddressResolutionResponse,
  type AddressSuggestion,
  type AddressSuggestionsResponse,
} from "@magna-carta/api-client";
import type {
  AddressLookup,
  AddressLookupAnswer,
  AddressLookupResolution,
  AddressOffer,
  AddressParts,
} from "@magna-carta/design-system/address-fields";

/** The two calls, as ports, so a test can answer them without a server. */
export interface AddressLookupPorts {
  suggest(country: string, query: string, near?: string): Promise<AddressSuggestionsResponse>;
  resolve(suggestionId: string): Promise<AddressResolutionResponse>;
}

/** The ports over the generated client. Both throw on failure, which is the contract above. */
export const generatedAddressLookupPorts: AddressLookupPorts = {
  async suggest(country, query, near) {
    const { data } = await addressLookupSuggest({
      body: { country, query, ...(near === undefined ? {} : { near }) },
      throwOnError: true,
    });
    return data;
  },
  async resolve(suggestionId) {
    const { data } = await addressLookupResolve({
      body: { suggestionId },
      throwOnError: true,
    });
    return data;
  },
};

function offerFrom(suggestion: AddressSuggestion): AddressOffer {
  return {
    identifier: suggestion.suggestionId,
    label: suggestion.label,
    kind: suggestion.kind,
    ...(suggestion.count === undefined ? {} : { count: suggestion.count }),
  };
}

// The same keys on both sides — the stored columns are named for their position in an address, so
// the Worker's parts and the form's parts are one vocabulary. Copied, not aliased.
function partsFrom(parts: AddressLookupParts): AddressParts {
  return { ...parts };
}

/**
 * The form's region as a bias the Worker accepts: a subdivision code ("NC"), or nothing. A region a
 * person typed out in full is not a code, and sending it would refuse the whole request — the bias
 * is a nicety, so it is dropped rather than allowed to cost the suggestions.
 */
function regionCodeOf(near: string | undefined): string | undefined {
  const region = near?.trim() ?? "";
  return /^[A-Za-z0-9]{1,3}$/u.test(region) ? region : undefined;
}

export function addressLookup(
  ports: AddressLookupPorts = generatedAddressLookupPorts,
): AddressLookup {
  return {
    async suggest(country: string, query: string, near?: string): Promise<AddressLookupAnswer> {
      const body = await ports.suggest(country, query, regionCodeOf(near));
      if (body.outcome === "suggestions") {
        return { kind: "offers", offers: body.suggestions.map(offerFrom) };
      }
      return { kind: body.outcome };
    },

    async resolve(identifier: string): Promise<AddressLookupResolution> {
      const body = await ports.resolve(identifier);
      switch (body.outcome) {
        case "address":
          return { kind: "address", parts: partsFrom(body.parts) };
        case "group":
          return { kind: "group", offers: body.suggestions.map(offerFrom) };
        default:
          return { kind: body.outcome };
      }
    },
  };
}
