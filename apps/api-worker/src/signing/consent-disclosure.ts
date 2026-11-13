// The agreement to sign electronically a signer is shown before anything else, by version. Each
// version is kept for as long as any consent recorded under it is, because the version on the
// signer's row is how the exact words they agreed to are reproduced later. A change of wording is a
// new version beside the old, never an edit of one in place.

export interface ConsentDisclosure {
  readonly version: string;
  readonly title: string;
  /** Paragraphs, with `{firm}` and `{sender}` filled in as the page shows them. */
  readonly paragraphs: readonly string[];
}

const DISCLOSURES: Readonly<Record<string, ConsentDisclosure>> = {
  "2026-11": {
    version: "2026-11",
    title: "Agreement to sign electronically",
    paragraphs: [
      "{firm} has asked you to sign this document electronically. By choosing Agree, you agree to receive and sign it electronically, and that your electronic signature is as binding as a signature by hand.",
      "You may ask for a paper copy, or choose to sign on paper instead, by contacting {sender}; this may delay the document.",
      "You can withdraw this agreement at any time before you finish signing by choosing Decline to Sign.",
      "To view and sign, you need a current web browser and an email account. Keep a copy of the signed document for your records; you will be sent a link to download it.",
    ],
  },
};

/** The version every new consent is recorded under. */
export const CURRENT_CONSENT_VERSION = "2026-11";

/** The disclosure at a version, its names filled in; the current one when none is given. */
export function consentDisclosure(
  names: { readonly firm: string; readonly sender: string },
  version: string = CURRENT_CONSENT_VERSION,
): ConsentDisclosure {
  const found = DISCLOSURES[version] ?? DISCLOSURES[CURRENT_CONSENT_VERSION];
  if (found === undefined) throw new Error("The current consent disclosure is missing.");
  const firm = names.firm === "" ? "The firm" : names.firm;
  return {
    ...found,
    paragraphs: found.paragraphs.map((paragraph) =>
      paragraph.replaceAll("{firm}", firm).replaceAll("{sender}", names.sender),
    ),
  };
}
