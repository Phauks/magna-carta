// Every refusal carries a stable machine-readable code: callers (API layer, fixtures assertions)
// branch on codes, never on message text. One error type for the whole locations module.
export type LocationValidationCode =
  | "empty-location-name"
  | "unknown-location"
  | "location-is-firm-default"
  | "duplicate-address-kind"
  | "member-needs-one-primary";

export class LocationValidationError extends Error {
  constructor(
    readonly code: LocationValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "LocationValidationError";
  }
}
