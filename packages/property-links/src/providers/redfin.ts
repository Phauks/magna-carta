import { formatAddress } from "../format.ts";
import type { LinkProvider } from "../types.ts";

// https://www.redfin.com/?location={encoded address} — lands on the search/map result, auto-
// navigating to the listing on a single exact match (Redfin needs an internal property id we do
// not have for a guaranteed detail URL).
export const redfinProvider: LinkProvider = {
  id: "redfin",
  label: "Redfin",
  build(reference) {
    const address = formatAddress(reference);
    if (address === null) return null;
    return `https://www.redfin.com/?location=${encodeURIComponent(address)}`;
  },
};
