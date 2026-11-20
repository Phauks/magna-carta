// The ways an outside signer can prove who they are, as modules a firm turns on or off.
//
// A signer check is what the person preparing a request picks for each outside signer: the emailed
// link alone, a code sent by email, a code sent by text message, or a check run by an outside
// service. Each check names the attribution level it earns on the certificate and what it needs
// before it can be offered: nothing, the deployment's text-message service, or a connected outside
// service. The firm's own choice of which to offer is read from its signing settings; this module
// only answers, from that choice and from what the deployment has ready, which checks are offered.
//
// Firm members are not here. A member signs inside the app, signed in, and is never offered a
// choice of check.

import type { AttributionLevel } from "./esign.ts";

export type SignerCheck = "email-link" | "email-code" | "text-code" | "identity-check";

/** In the order the chooser lists them. */
export const SIGNER_CHECKS: readonly SignerCheck[] = [
  "email-link",
  "email-code",
  "text-code",
  "identity-check",
];

/** Where an access code is sent. */
export type CodeChannel = "email" | "text";

/** What a check needs before a firm can offer it. */
export type SignerCheckNeed = "nothing" | "text-service" | "outside-service";

export interface SignerCheckModule {
  readonly check: SignerCheck;
  /** What the certificate records for a signer who passed it. */
  readonly attribution: AttributionLevel;
  /** Where the code goes, for a check that sends one. */
  readonly codeChannel?: CodeChannel;
  readonly needs: SignerCheckNeed;
  /** The email link is the floor every outside signer stands on, so a firm cannot turn it off. */
  readonly alwaysOn: boolean;
  /** The name a member sees in the chooser and on settings. */
  readonly label: string;
}

export const SIGNER_CHECK_MODULES: Readonly<Record<SignerCheck, SignerCheckModule>> = {
  "email-link": {
    check: "email-link",
    attribution: "email-link",
    needs: "nothing",
    alwaysOn: true,
    label: "Email Link",
  },
  "email-code": {
    check: "email-code",
    attribution: "access-code",
    codeChannel: "email",
    needs: "nothing",
    alwaysOn: false,
    label: "Email Code",
  },
  "text-code": {
    check: "text-code",
    attribution: "access-code",
    codeChannel: "text",
    needs: "text-service",
    alwaysOn: false,
    label: "Text Code",
  },
  "identity-check": {
    check: "identity-check",
    attribution: "id-verified",
    needs: "outside-service",
    alwaysOn: false,
    label: "Identity Check",
  },
};

/** The firm's choice, as its signing settings store it. */
export interface SignerCheckChoice {
  readonly emailCode: boolean;
  readonly textCode: boolean;
  readonly identityCheck: boolean;
  /** What a new outside signer starts with in the chooser. */
  readonly startWith: SignerCheck;
}

/**
 * What a firm that has never opened its signing settings gets: the two checks every request could
 * use before the firm had a choice, starting new signers on the emailed code as they always have.
 */
export const DEFAULT_SIGNER_CHECK_CHOICE: SignerCheckChoice = {
  emailCode: true,
  textCode: false,
  identityCheck: false,
  startWith: "email-code",
};

/** What this deployment, and this firm's connections, have ready. */
export interface SignerCheckReadiness {
  /** The text-message service is provisioned. */
  readonly textService: boolean;
  /** An outside identity-check service is connected. */
  readonly identityService: boolean;
}

/** Whether the deployment can run a check at all, whatever the firm chose. */
export function checkIsReady(check: SignerCheck, readiness: SignerCheckReadiness): boolean {
  switch (SIGNER_CHECK_MODULES[check].needs) {
    case "nothing":
      return true;
    case "text-service":
      return readiness.textService;
    case "outside-service":
      return readiness.identityService;
  }
}

function chosen(check: SignerCheck, choice: SignerCheckChoice): boolean {
  switch (check) {
    case "email-link":
      return true;
    case "email-code":
      return choice.emailCode;
    case "text-code":
      return choice.textCode;
    case "identity-check":
      return choice.identityCheck;
  }
}

/** The checks a member may pick for an outside signer: turned on by the firm and ready to run. */
export function offeredChecks(
  choice: SignerCheckChoice,
  readiness: SignerCheckReadiness,
): SignerCheck[] {
  return SIGNER_CHECKS.filter((check) => chosen(check, choice) && checkIsReady(check, readiness));
}

/** The check a new outside signer starts with: the firm's pick when offered, else the email link. */
export function startingCheck(
  choice: SignerCheckChoice,
  readiness: SignerCheckReadiness,
): SignerCheck {
  return offeredChecks(choice, readiness).includes(choice.startWith)
    ? choice.startWith
    : "email-link";
}

/** The check a stored signer was given, from the attribution and where its code goes. */
export function checkOf(
  attribution: AttributionLevel,
  codeChannel: CodeChannel | null,
): SignerCheck | null {
  if (attribution === "email-link") return "email-link";
  if (attribution === "access-code") return codeChannel === "text" ? "text-code" : "email-code";
  if (attribution === "id-verified") return "identity-check";
  return null;
}

/**
 * A number a text can be sent to, in E.164 (`+` and up to fifteen digits), or null.
 *
 * A number written with a leading `+` is taken as international. Without one, ten digits, or eleven
 * starting with 1, are read as a North American number, because that is how a firm in the United
 * States writes a client's mobile; any other national form is refused rather than guessed at, since
 * a code texted to the wrong country is a code texted to a stranger.
 */
export function textableNumber(entered: string): string | null {
  const trimmed = entered.trim();
  const digits = trimmed.replaceAll(/[^0-9]/g, "");
  if (/[^0-9+().\-\s]/.test(trimmed)) return null;
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")
      ? `+${digits}`
      : null;
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && /^1[2-9]/.test(digits)) return `+${digits}`;
  return null;
}

/** A number shown back to the signer with only its last four digits, as `(•••) •••-0147`, kept on one line. */
export function maskedNumber(number: string): string {
  const digits = number.replaceAll(/[^0-9]/g, "");
  const last = digits.slice(-4);
  return `(•••)\u00a0•••-${last}`;
}
