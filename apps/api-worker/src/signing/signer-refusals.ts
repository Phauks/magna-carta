import type { GuestLaneRefusal } from "../http/chokepoint/chokepoint.ts";
import type { RequestStatus, SignerStatus } from "@magna-carta/signing/request";

// The one table from why a signing link cannot be used to the sentence its holder is told, read by
// the chokepoint's signer lane so one condition says one thing. Every sentence is about the link and
// the request; none of them names the firm's member, the matter, or another signer.

export type SignerLinkRefusalCode =
  | "not-valid"
  | "expired"
  | "cancelled"
  | "declined"
  | "completed"
  | "signed";

const ASK = "Ask whoever sent it for a new link.";

export function signerLinkRefusalFor(code: SignerLinkRefusalCode): GuestLaneRefusal {
  switch (code) {
    case "not-valid":
      return {
        type: "signing-link-not-valid",
        status: 410,
        title: "This link no longer works",
        detail: `This link has been replaced by a newer one. ${ASK}`,
      };
    case "expired":
      return {
        type: "signing-link-expired",
        status: 410,
        title: "This link has expired",
        detail: `The last day to sign this document has passed. ${ASK}`,
      };
    case "cancelled":
      return {
        type: "signing-request-closed",
        status: 410,
        title: "This request was cancelled",
        detail: "Whoever sent this document has cancelled the request. There is nothing to sign.",
      };
    case "declined":
      return {
        type: "signing-request-closed",
        status: 410,
        title: "This request was declined",
        detail: "Someone declined to sign this document, so the request has ended.",
      };
    case "completed":
    case "signed":
      return {
        type: "signing-request-closed",
        status: 410,
        title: "You have already signed",
        detail: "Your signature is recorded. You will be emailed a copy once everyone has signed.",
      };
  }
}

/** What the signer's row and the request say about a link, decided in one place. */
export function signerLinkRefusal(input: {
  readonly found: boolean;
  readonly secretMatches: boolean;
  readonly storedVersion: number;
  readonly presentedVersion: number;
  readonly requestStatus: RequestStatus;
  readonly expiresAt: string;
  readonly signerStatus: SignerStatus;
  readonly now: string;
}): SignerLinkRefusalCode | null {
  if (!input.found || !input.secretMatches || input.storedVersion !== input.presentedVersion) {
    return "not-valid";
  }
  if (input.signerStatus === "signed") return "signed";
  switch (input.requestStatus) {
    case "voided":
      return "cancelled";
    case "declined":
      return "declined";
    case "completed":
      return "completed";
    case "expired":
      return "expired";
    case "draft":
      return "not-valid";
    case "sent":
      return Date.parse(input.expiresAt) <= Date.parse(input.now) ? "expired" : null;
  }
}
