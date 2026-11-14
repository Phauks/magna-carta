/*
 * A link that opens an address in Google Maps, for the button beside a saved address.
 *
 * A PLAIN MAPS URL, NOT THE PLACES API. Google's documented search URL takes the address as text
 * and needs no key, so following it costs the firm nothing and calls nothing of ours. It does hand
 * the client's address to Google, in the person's own browser, which is what pressing the button
 * asks for; nothing here sends it anywhere on its own.
 *
 * https://developers.google.com/maps/documentation/urls/get-started#search-action
 */
const GOOGLE_MAPS_SEARCH = "https://www.google.com/maps/search/";

/** The Maps search link for an address written on one line, or null for a blank one. */
export function googleMapsLinkFor(oneLineAddress: string): string | null {
  const query = oneLineAddress.trim();
  if (query === "") return null;
  const url = new URL(GOOGLE_MAPS_SEARCH);
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}
