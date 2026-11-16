import { formatInstant } from "@magna-carta/design-system/formatters";
import { signerPageLink, SIGNER_SCREEN_PATH } from "./signer-link.ts";

// THE MAILS A SIGNER RECEIVES, pure and testable.
//
// WHAT THEY CARRY, AND WHAT THEY NEVER DO. The firm's name, the sender's name, the document's title,
// the sender's own message and subject, the last day it can be signed, and the link. No matter name or
// number, no other signer's name or address, and never the document itself: the document is opened on
// the signing page, behind the link.
//
// THE LINK GOES TO A PAGE THAT SIGNS NOTHING ON OPEN. A mail scanner that follows every address and
// a person who clicks twice cost nothing; signing is a separate act on the page.

/** The class each send is counted under, never the body or the address. */
export const SIGNING_REQUEST_MESSAGE_CLASS = "signing-request";
export const SIGNING_REMINDER_MESSAGE_CLASS = "signing-reminder";
export const SIGNING_ACCESS_CODE_MESSAGE_CLASS = "signing-access-code";

export interface SigningLetterFacts {
  readonly firmName: string;
  readonly senderName: string;
  readonly subject: string;
  readonly message: string;
  readonly title: string;
  /** When it stops being signable, already written for a reader, with its zone named. */
  readonly lastDay: string;
  readonly origin: string;
  readonly token: string;
  readonly needsCode: boolean;
}

function firmOf(name: string): string {
  return name === "" ? "A firm" : name;
}

function body(facts: SigningLetterFacts, opening: string): string {
  const link = signerPageLink(facts.origin, facts.token);
  const message = facts.message.trim() === "" ? "" : `${facts.message.trim()}\n\n`;
  const code = facts.needsCode
    ? "Before you can sign, you will be asked for a one-time code. It is sent to this address when you ask for it on the page.\n\n"
    : "";
  return (
    `${opening}\n\n${facts.title}\n\n${message}` +
    `Open this link to read and sign it:\n\n${link}\n\n${code}` +
    `It can be signed until ${facts.lastDay}.\n\n` +
    `If your mail program does not open links, go to ${facts.origin}${SIGNER_SCREEN_PATH}/ followed by this code:\n\n${facts.token}\n\n` +
    `This link is for you; do not forward it. If you were not expecting this, you can ignore it.`
  );
}

export function signingRequestEmail(facts: SigningLetterFacts): {
  readonly subject: string;
  readonly text: string;
} {
  return {
    subject: facts.subject,
    text: body(
      facts,
      `${facts.senderName} at ${firmOf(facts.firmName)} has sent you a document to sign.`,
    ),
  };
}

export function signingReminderEmail(facts: SigningLetterFacts): {
  readonly subject: string;
  readonly text: string;
} {
  return {
    subject: `Reminder: ${facts.subject}`,
    text: body(
      facts,
      `A reminder: ${facts.senderName} at ${firmOf(facts.firmName)} is waiting for you to sign a document.`,
    ),
  };
}

export function accessCodeEmail(input: {
  readonly firmName: string;
  readonly code: string;
  readonly minutes: number;
}): { readonly subject: string; readonly text: string } {
  return {
    subject: "Your code to sign a document",
    text:
      `Your code to sign the document ${firmOf(input.firmName)} sent you is:\n\n${input.code}\n\n` +
      `It works for ${input.minutes} minutes. If you did not ask for it, you can ignore this message; nobody can sign without the link as well.`,
  };
}

/**
 * The instant a request stops being signable, written for a reader. The server does not know the
 * reader's zone, so the instant is written in UTC and says so, rather than a day that may be the
 * wrong one where they are.
 */
export function lastDayOf(expiresAt: string): string {
  return `${formatInstant(expiresAt, { locale: "en-US", timeZone: "UTC" })} UTC`;
}
