import { formatAddress } from "../format.ts";
import type { LinkProvider } from "../types.ts";

// https://www.zillow.com/homes/{slug}_rb/ — the slug is the address with commas removed and runs of
// whitespace collapsed to single hyphens; Zillow geocodes it and usually redirects to the property
// page. encodeURIComponent guards any remaining path-unsafe characters (hyphens are left intact).
export const zillowProvider: LinkProvider = {
  id: "zillow",
  label: "Zillow",
  build(reference) {
    const address = formatAddress(reference);
    if (address === null) return null;
    const slug = encodeURIComponent(address.replace(/,/g, "").trim().replace(/\s+/g, "-"));
    return `https://www.zillow.com/homes/${slug}_rb/`;
  },
};
