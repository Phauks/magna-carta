/*
 * What an address form is handed and what it hands back. Here rather than in the component so a
 * module with no Svelte in it — a draft, a request builder — can name them without pulling a
 * component tree in.
 */
import type { AddressFieldKey } from "./address-format.ts";

/** One country the field offers: the code the record stores, and what a reader calls it. */
export interface AddressCountry {
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly name: string;
}

/**
 * One administrative area the region box offers: the value a record stores, and what a reader calls
 * it. Separate from AddressCountry despite the shape, because the two answer different questions and
 * a shared name would invite one list to be handed where the other belongs.
 *
 * For a country that publishes no separate code the two are equal — Ireland stores "Co. Carlow".
 */
export interface AddressAdministrativeArea {
  readonly code: string;
  readonly name: string;
}

/**
 * The address as its parts — the international field set, every one of them optional.
 *
 * A missing key and an empty string mean the same thing here: the firm holds nothing for that line.
 */
export type AddressParts = Partial<Record<AddressFieldKey, string>> & { country?: string };
