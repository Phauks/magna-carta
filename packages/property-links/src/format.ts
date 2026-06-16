import type { PropertyReference } from "./types.ts";

// Joins the address components into one human-style line, or returns the caller's pre-formatted
// string when given. Returns null when there is too little to locate a property — a street plus at
// least one of city/postal — so a provider then declines to build a link (the total-function rule).
export function formatAddress(reference: PropertyReference): string | null {
  const explicit = reference.formattedAddress?.trim();
  if (explicit) return explicit;

  const street = reference.street?.trim();
  const city = reference.city?.trim();
  const region = reference.region?.trim();
  const postal = reference.postal?.trim();
  if (!street || (!city && !postal)) return null;

  const regionPostal = [region, postal].filter(Boolean).join(" ");
  return [street, city, regionPostal].filter(Boolean).join(", ");
}
