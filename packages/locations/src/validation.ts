// Every refusal carries a stable machine-readable code: callers (API layer, fixtures assertions)
// branch on codes, never on message text. One error type for the whole locations module.
export type LocationValidationCode =
  | "empty-location-name"
  | "unknown-location"
  | "location-is-firm-default"
  | "duplicate-address-kind"
  | "member-needs-one-primary"
  // The letterhead logo's bytes are not a picture this platform will draw into a document — see
  // @magna-carta/document-assembly's image module for which two formats are, and why only those two.
  | "unsupported-logo-format"
  // A printed width that is not a positive measurement. A logo with no size has no way to be drawn.
  | "invalid-logo-width"
  // A time zone that is not an IANA identifier a runtime can resolve. A fixed offset is refused on
  // the same footing: it is wrong for half the year in every zone that observes daylight saving,
  // which is exactly the failure storing a zone rather than an offset exists to prevent.
  | "unknown-time-zone";

export class LocationValidationError extends Error {
  constructor(
    readonly code: LocationValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "LocationValidationError";
  }
}
