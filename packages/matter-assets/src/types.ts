// The closed vocabularies of the matter asset register, and the two bounds a request is held to.
// Every list here is a platform vocabulary rather than a per-firm catalog, and each one earns that:
// a class decides which structured columns exist, a basis is read by reports and eventually by a
// court, and a disposition and an estate treatment are grouped by every schedule. What a firm names
// its own kinds of thing lives in the matter_asset_type catalog instead, which is where the long
// tail belongs.

// The platform class. Closed, deliberately against the per-firm-type precedent the custody register
// set: there the type drives an icon and one default flag, so a firm inventing one costs nothing.
// Here the class decides which attribute table exists, which merge subject the row appears under,
// and which column a search hits — a firm cannot mint the concept "has a parcel number", which is a
// schema fact with a table, an index, and a report column behind it. Adding a class is a platform
// change with a migration, and that cost is exactly the work adding one actually implies.
export const MATTER_ASSET_CLASSES = [
  "realProperty",
  "financialAccount",
  "vehicle",
  "firearm",
  "businessInterest",
  "insurancePolicy",
  "receivable",
  "digitalAsset",
  "personalProperty",
  "other",
] as const;
export type MatterAssetClass = (typeof MATTER_ASSET_CLASSES)[number];

// Asserted by a person, NEVER derived. Whether a jointly held house passes outside probate turns on
// the form of co-ownership, which is jurisdiction-specific and unevenly named; encoding "joint
// tenancy means non-probate" would be right in most states and catastrophic in the ones where it is
// not, on the one document a court reads. `undetermined` is the default and is reported as its own
// group rather than merged away.
export const MATTER_ASSET_ESTATE_TREATMENTS = [
  "probateEstate",
  "nonProbateTransfer",
  "undetermined",
] as const;
export type MatterAssetEstateTreatment = (typeof MATTER_ASSET_ESTATE_TREATMENTS)[number];

// What became of the thing. The PRICE of a sale is deliberately not part of this: it is a valuation
// row with basis `sale`, so there is one home for every number.
export const MATTER_ASSET_DISPOSITIONS = [
  "retained",
  "sold",
  "transferred",
  "distributed",
  "abandoned",
  "lost",
] as const;
export type MatterAssetDisposition = (typeof MATTER_ASSET_DISPOSITIONS)[number];

// What a figure rests on. Closed because reports, merge fields, and eventually a court read it, and
// a firm inventing its own basis is not a capability anyone wants. `sale` is how a disposition's
// price enters. `automatedEstimate` exists with nothing writing it, so an external valuation adapter
// has a truthful basis to write and can never masquerade as an appraisal.
export const MATTER_ASSET_VALUATION_BASES = [
  "appraisal",
  "statement",
  "taxAssessment",
  "marketQuote",
  "guideBook",
  "broker",
  "sale",
  "purchasePrice",
  "courtDetermined",
  "clientEstimate",
  "automatedEstimate",
] as const;
export type MatterAssetValuationBasis = (typeof MATTER_ASSET_VALUATION_BASES)[number];

// What a linked document IS, for the firm's own filing. Nothing branches on it.
export const MATTER_ASSET_DOCUMENT_KINDS = [
  "deed",
  "title",
  "statement",
  "appraisal",
  "policy",
  "registration",
  "billOfSale",
  "photograph",
  "correspondence",
  "other",
] as const;
export type MatterAssetDocumentKind = (typeof MATTER_ASSET_DOCUMENT_KINDS)[number];

// The kinds of number that are credential-adjacent secrets rather than public record, and so are
// sealed with only their last four characters readable. Every one of these appears on a statement or
// a policy schedule and nowhere a member of the public can look it up. The public-record identifiers
// — a parcel number, a vehicle identification number, a plate, a firearm serial — are ordinary
// plaintext columns on their class's attribute table, because searching by them is the point.
export const MATTER_ASSET_IDENTIFIER_KINDS = [
  "accountNumber",
  "policyNumber",
  "certificateNumber",
  "taxIdentifier",
  "other",
] as const;
export type MatterAssetIdentifierKind = (typeof MATTER_ASSET_IDENTIFIER_KINDS)[number];

// Names for things this register REFUSES to hold in any column, plaintext or sealed. A protected
// column is decryptable by any member holding the decrypt permission, and for a self-custodied
// digital asset the seed phrase IS the asset: whoever reads it can take it, irreversibly, with no
// record. Storing one would convert a records system into a bearer instrument. Matched
// case-insensitively with punctuation and spacing removed, so "seed phrase", "seed-phrase", and
// "seedPhrase" are the same refusal, and the refusal carries its own explainable failure rather than
// an unknown-kind shrug. The correct home for a secret whose disclosure IS a transfer of the asset
// is a sealed envelope in the custody register, where a physical object has a location, a hold, and
// an append-only record of every hand it has passed through.
export const REFUSED_CREDENTIAL_IDENTIFIER_NAMES = [
  "password",
  "passcode",
  "passphrase",
  "pin",
  "personalidentificationnumber",
  "seed",
  "seedphrase",
  "recoveryphrase",
  "mnemonic",
  "privatekey",
  "secretkey",
  "apikey",
  "accesskey",
  "safecombination",
  "combination",
  "securitycode",
  "cvv",
  "logincredential",
  "credential",
] as const;

// The bulk-entry bound. Twenty items from a client questionnaire is the gesture the batch route
// exists for; the cap is well above that and well below anything that would make one commit
// unbounded. A request over it is REFUSED rather than truncated — a caller that sent sixty rows and
// silently had forty written cannot tell that from forty rows it never sent.
export const MAX_MATTER_ASSET_BATCH = 50;

// The largest number of characters of a sealed identifier that is ever readable without a decrypt.
// Four, because "account ending 4417" is what a letter needs and anything longer starts to be the
// number itself.
export const MAX_IDENTIFIER_DISPLAY_SUFFIX = 4;

export const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
