import { MAX_REFERENCE_NAME_LENGTH } from "./types.ts";
import { ExhibitValidationError } from "./validation.ts";

// An exhibit's reference name: the stable handle an in-text reference cites ({{@leaseAgreement}}),
// so a document keeps citing the right exhibit after its title is reworded and after the set is
// reordered.
//
// THE MINT IS ONE-SHOT. A name is made from the first title an exhibit is given and is never
// recomputed from a later one. Recomputing on retitle would silently break every document that
// already cites the exhibit — the exact defect references exist to prevent.

const VALID_REFERENCE_NAME = new RegExp(`^[a-z][A-Za-z0-9]{0,${MAX_REFERENCE_NAME_LENGTH - 1}}$`);

/** True when a name is lower camel case: a lower-case letter, then letters and digits only. */
export function isValidReferenceName(name: string): boolean {
  return VALID_REFERENCE_NAME.test(name);
}

export function assertReferenceName(value: unknown): string {
  if (typeof value !== "string" || !isValidReferenceName(value)) {
    throw new ExhibitValidationError(
      "exhibit-reference-name-invalid",
      "a reference name starts with a lower-case letter and holds only letters and digits",
    );
  }
  return value;
}

/**
 * The base name a title mints: "Commercial Lease Agreement, 1200 Harbor Way" becomes
 * "commercialLeaseAgreement1200HarborWay". Accents are folded and anything that is not a letter or a
 * digit separates words. A title with no letters at all mints "exhibit".
 */
export function referenceNameBaseFor(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  let name = words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
  if (!/^[a-z]/.test(name)) {
    name = name.length === 0 ? "exhibit" : `exhibit${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  // Leave room for a numeric suffix so a deduplicated name stays within the bound.
  return name.slice(0, MAX_REFERENCE_NAME_LENGTH - 4);
}

/**
 * The name to mint, given the names the matter already holds that start with the base. The base
 * itself when it is free; otherwise the base with the smallest suffix from 2 that is free.
 */
export function mintReferenceName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
