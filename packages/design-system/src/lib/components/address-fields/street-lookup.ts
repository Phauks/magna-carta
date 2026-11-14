/*
 * The rules around offering addresses from the street box, separated from the box that runs them —
 * the same split the entity picker makes with picker-search.ts, and for the same reason: they are
 * settled behaviour rather than presentation, and a rendered field cannot show them to a test.
 *
 * THE BOX NEVER FETCHES. The caller hands AddressFields an `AddressLookup` and the field owns what
 * surrounds it: letting typed text settle, refusing to ask below the floor, discarding an answer a
 * newer question has overtaken, and keeping four different "no offers" apart — nothing matched, the
 * country is not covered, no service is provisioned, and the service did not answer.
 *
 * WHAT IS TYPED IS THE ADDRESS. Unlike a picker, this box holds a value whether or not anything is
 * chosen from its list: the street line a person types is the street line the record keeps. Offers
 * are a shortcut to typing the rest of the form, never a gate on typing this line.
 */
import type { AddressFieldKey } from "./address-format.ts";
import type { AddressParts } from "./types.ts";

/** One address offered for what has been typed. Domain-blind: the caller maps its service to this. */
export interface AddressOffer {
  /** The caller's handle for the offer, handed back to `resolve`. Opaque here. */
  readonly identifier: string;
  /** The whole offer on one line, as the list shows it. */
  readonly label: string;
  /**
   * One address, or a group — a building whose units share one street line. A group is not an
   * address a record can hold, so choosing it opens the addresses inside it rather than filling the
   * form with the building's line.
   */
  readonly kind: "address" | "group";
  /** For a group, how many addresses it holds, where the service says. */
  readonly count?: number;
}

/** A provider whose terms require its name beside its offers. */
export type AddressOfferAttribution = "google-maps";

/**
 * The words each attribution shows, exactly as the provider requires them: Google asks for "Google
 * Maps" on one line, never translated, never shortened.
 */
export const ADDRESS_OFFER_ATTRIBUTION_TEXT: Readonly<Record<AddressOfferAttribution, string>> = {
  "google-maps": "Google Maps",
};

/** What a search came to. A search that could not run is a REJECTION, never one of these. */
export type AddressLookupAnswer =
  | {
      readonly kind: "offers";
      readonly offers: readonly AddressOffer[];
      /**
       * Whose data the offers are, when the provider's terms require the list to say so. The list
       * shows the provider's name below the offers, in the same container, untranslated.
       */
      readonly attribution?: AddressOfferAttribution;
    }
  | { readonly kind: "no-coverage" }
  | { readonly kind: "unavailable" };

/** What choosing an offer came to. A resolution that could not run is a rejection, as above. */
export type AddressLookupResolution =
  | { readonly kind: "address"; readonly parts: AddressParts }
  | { readonly kind: "group"; readonly offers: readonly AddressOffer[] }
  | { readonly kind: "expired" }
  | { readonly kind: "no-coverage" }
  | { readonly kind: "unavailable" };

/**
 * The seam AddressFields is handed. Both calls may reject; a rejection is the "did not answer" state,
 * so a failed service is never rendered as a country with no matching addresses.
 */
export interface AddressLookup {
  /**
   * `near` is the region the form already holds, as it holds it — a bias for the service to rank
   * nearby addresses first, never a filter. The lookup decides whether it is a region it can use.
   */
  suggest(country: string, query: string, near?: string): Promise<AddressLookupAnswer>;
  resolve(identifier: string): Promise<AddressLookupResolution>;
}

/**
 * How long typed text settles before it is asked. Every question sent to an address service is a
 * billed lookup, so a request per keystroke would be a charge per keystroke for a question nobody
 * has finished asking.
 */
export const ADDRESS_SETTLE_MILLISECONDS = 300;

/**
 * The shortest street line worth asking about. A house number alone matches half a country, and an
 * answer to it is a bill for a list nobody will read.
 */
export const MINIMUM_ADDRESS_QUERY_LENGTH = 3;

/** Whether typed text is a question worth sending, given the country the address is in. */
export type AddressLookupRequest =
  | { readonly kind: "nothing" }
  | { readonly kind: "too-short" }
  | { readonly kind: "ask"; readonly country: string; readonly query: string };

export function addressLookupRequestFor(
  typed: string,
  country: string | undefined,
): AddressLookupRequest {
  const query = typed.trim();
  // No country is no question: which country an address is in decides what it can match, and the
  // form asks for the country first for exactly that reason.
  if (query === "" || country === undefined || country === "") return { kind: "nothing" };
  if (query.length < MINIMUM_ADDRESS_QUERY_LENGTH) return { kind: "too-short" };
  return { kind: "ask", country, query };
}

/** Everything the list can say instead of offers. One sentence each, so every form says it the same way. */
export const ADDRESS_LOOKUP_SENTENCES = {
  searching: "Looking up addresses",
  nothingMatched: "No address matches. Keep typing, or fill the address in by hand.",
  noCoverage: "Addresses in this country cannot be looked up. Fill the address in by hand.",
  failed: "Addresses could not be looked up. The address can still be typed.",
  expired: "That address is no longer offered. Keep typing to look it up again.",
  retry: "Try Again",
} as const;

/** The line above a group's addresses once it is opened, so the list says where it now is. */
export function groupHeading(offer: AddressOffer): string {
  return `Addresses at ${offer.label}`;
}

/** What a group row says after its label: how many addresses it holds, or that it holds several. */
export function groupAside(offer: AddressOffer): string {
  if (offer.count === undefined) return "Several addresses";
  return offer.count === 1 ? "1 address" : `${String(offer.count)} addresses`;
}

/** The parts an offer can fill. The recipient and organization lines are the person's, never a lookup's. */
const FILLED_BY_LOOKUP: readonly (AddressFieldKey | "country")[] = [
  "street",
  "streetTwo",
  "dependentLocality",
  "city",
  "region",
  "postal",
  "sortingCode",
  "country",
];

/**
 * The form after a chosen address is written into it.
 *
 * EVERY PART THE CHOICE CARRIES REPLACES WHAT WAS THERE; EVERY PART IT DOES NOT CARRY IS LEFT ALONE.
 * Choosing an address is a deliberate act that says "this is the address", so a stale town or postal
 * code from an earlier attempt must not survive it. But a service that returns a building without its
 * unit has said nothing about the unit, and the "Apt 4B" somebody typed is exactly the line it could
 * not know — clearing it would lose the one part of the address the person supplied themselves. The
 * recipient and organization lines are never touched: no lookup knows who the letter is for.
 */
export function withResolvedAddress(current: AddressParts, resolved: AddressParts): AddressParts {
  const next: AddressParts = { ...current };
  for (const key of FILLED_BY_LOOKUP) {
    const part = resolved[key]?.trim();
    if (part !== undefined && part !== "") next[key] = part;
  }
  return next;
}
