/*
 * AddressFields — the one address form, shaped by the country the address is in.
 * The per-country field set, labels and order are `address-format.ts`; the component renders them.
 */
export { default } from "./address-fields.svelte";
export { default as AddressFields } from "./address-fields.svelte";
export type { AddressAdministrativeArea, AddressCountry, AddressParts } from "./types.ts";
export {
  addressFieldsFor,
  addressFormatFor,
  countriesWithKnownFormat,
  INTERNATIONAL_FORMAT,
  type AddressFieldKey,
  type AddressFieldSpec,
  type AddressFormat,
} from "./address-format.ts";
export {
  ADDRESS_LOOKUP_SENTENCES,
  withResolvedAddress,
  type AddressLookup,
  type AddressLookupAnswer,
  type AddressLookupResolution,
  type AddressOffer,
} from "./street-lookup.ts";
