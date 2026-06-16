import { formatAddress } from "../format.ts";
import type { LinkProvider } from "../types.ts";

// https://www.google.com/maps/search/?api=1&query={encoded address} — the official Google Maps URLs
// API; drops a pin at the geocoded address and opens the Maps app via Universal/App Links when
// installed, the website otherwise. `api=1` is required.
export const googleMapsProvider: LinkProvider = {
  id: "googleMaps",
  label: "Google Maps",
  build(reference) {
    const address = formatAddress(reference);
    if (address === null) return null;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  },
};
