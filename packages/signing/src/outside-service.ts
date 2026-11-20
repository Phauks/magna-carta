// The connection point for outside signing services: an identity check run by a vendor, and an
// online notary session.
//
// No vendor is chosen yet, so no adapter exists and every firm reads as not connected. The port is
// declared now so that the settings screen, the chooser and the signer's steps are written against
// it: the day a vendor is picked, its adapter implements this shape and the firm connects it, and
// nothing on either side changes.
//
// The shape is the one every identity vendor shares: the signing lane starts a check for a signer
// and sends them to the vendor's page; the vendor reports a result against the reference it gave.
// Only the result and the vendor's reference are kept. Images of identity documents and the answers
// a signer gives the vendor stay with the vendor and never reach the firm's storage.

export type OutsideServiceKind = "identity-check" | "online-notary";

export const OUTSIDE_SERVICE_KINDS: readonly OutsideServiceKind[] = [
  "identity-check",
  "online-notary",
];

export interface OutsideServiceStart {
  /** The vendor's own reference for this check, recorded on the certificate. */
  readonly reference: string;
  /** Where the signer is sent to complete it. */
  readonly continueAt: string;
}

export type OutsideServiceResult =
  | { readonly kind: "passed"; readonly reference: string; readonly completedAt: string }
  | { readonly kind: "failed"; readonly reference: string }
  | { readonly kind: "pending" };

export interface OutsideSigningService {
  readonly kind: OutsideServiceKind;
  /** The vendor's name as a member sees it on settings. */
  readonly vendor: string;
  /** Start a check for a signer; `returnTo` is where the vendor sends them back. */
  start(
    signer: { readonly name: string; readonly email: string },
    returnTo: string,
  ): Promise<OutsideServiceStart>;
  /** Read the result of a check started earlier. */
  result(reference: string): Promise<OutsideServiceResult>;
}

/** Which outside services a firm has connected, by kind. Today, none: no vendor is wired in. */
export function connectedOutsideServices(): ReadonlyMap<OutsideServiceKind, OutsideSigningService> {
  return new Map();
}
