import type { LinkProvider, PropertyReference } from "../types.ts";

// https://www.realtor.com/realestateandhomes-search/{street}_{city}_{state}_{zip} — an address-scoped
// search slug: spaces within each part become hyphens, the parts join with underscores. Needs the
// full structured address (street/city/region/postal) to delimit the parts, so it cannot work from a
// pre-formatted string and returns null when any part is missing.
function slugPart(value: string): string {
  return encodeURIComponent(value.trim().replace(/,/g, "").replace(/\s+/g, "-"));
}

export const realtorProvider: LinkProvider = {
  id: "realtor",
  label: "Realtor.com",
  build(reference: PropertyReference) {
    const { street, city, region, postal } = reference;
    if (!street?.trim() || !city?.trim() || !region?.trim() || !postal?.trim()) return null;
    const slug = [slugPart(street), slugPart(city), slugPart(region), slugPart(postal)].join("_");
    return `https://www.realtor.com/realestateandhomes-search/${slug}`;
  },
};
