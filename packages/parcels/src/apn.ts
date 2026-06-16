import type { ParcelKeyFormat } from "./types.ts";

// Normalize a parcel key (APN/TMK) for use in a URL according to the jurisdiction's expected
// format. `stripSeparators` (the common case) drops the dashes, dots, colons, and whitespace
// counties vary on, leaving the bare identifier — so a user's "162-35-113-001" still matches a
// county's dashless parcel id. `keepSeparators` preserves the displayed form (only trimming), for
// sites like Tyler iasWorld that match on the formatted parcel id. `hawaiiTmk` reduces a Hawaii Tax
// Map Key to the 12-digit qPublic KeyValue. This only reshapes separators/structure, never the
// underlying digits beyond the documented per-format rule.
export function normalizeKey(value: string, format: ParcelKeyFormat): string {
  const trimmed = value.trim();
  switch (format) {
    case "keepSeparators":
      return trimmed;
    case "hawaiiTmk":
      return hawaiiTmk(trimmed);
    default:
      return trimmed.replace(/[\s.\-:]/g, "");
  }
}

// Hawaii TMK -> the 12-digit qPublic KeyValue: Zone(1) Section(1) Plat(3) Parcel(3) CPR(4), with the
// leading island division dropped (each county is one island group, so the island is implied by the
// site). Accepts the common entry forms — "(1) 9-4-044-078", "3-9-2-118-43", or a bare 12-digit key
// — and zero-pads each component. CPR (the condominium unit) defaults to 0000 when absent.
function hawaiiTmk(value: string): string {
  const bare = value.replace(/[\s.\-:()]/g, "");
  if (/^\d{12}$/.test(bare)) {
    return bare; // already a KeyValue
  }
  const hasParenIsland = /^\(\s*\d\s*\)/.test(value);
  let tokens = value
    .replace(/^\(\s*\d\s*\)\s*/, "")
    .split(/[\s.\-:]+/)
    .filter(Boolean);
  if (!hasParenIsland) {
    tokens = tokens.slice(1); // the first bare token is the island division
  }
  const [zone = "0", section = "0", plat = "0", parcel = "0", cpr = "0"] = tokens;
  return (
    zone.padStart(1, "0") +
    section.padStart(1, "0") +
    plat.padStart(3, "0") +
    parcel.padStart(3, "0") +
    cpr.padStart(4, "0")
  );
}
