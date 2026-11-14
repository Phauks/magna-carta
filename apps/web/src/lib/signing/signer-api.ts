/*
 * Everything an outside signer's page asks of the server.
 *
 * THE LINK IS THE ONLY CREDENTIAL, AND IT TRAVELS IN A HEADER. Every call carries the token from the
 * signer's mail in the signing-link header and sends no cookie: the page is served from the firm's
 * own origin, and a signer who also happens to be signed in as somebody else must not act as them.
 * Nor a referrer: the page's own address is `/sign/<token>`, so the browser's default would write the
 * link into the `Referer` of every call, and from there into every request record it passes.
 *
 * EVERY CALL ANSWERS WITH AN OUTCOME, so the page RENDERS a refusal rather than unwinding: a value, or
 * the `Failure` every failure surface renders from.
 *
 * OPENING THE PAGE SIGNS NOTHING. The read writes nothing; `openSigning` records that the signer
 * looked, which a mail scanner that follows links never does, because it runs no script.
 */
import {
  signerAdopt,
  signerCheckAccessCode,
  signerConsent,
  signerDecline,
  signerFinish,
  signerOpen,
  signerReadDocument,
  signerReadRequest,
  signerSendAccessCode,
  type SignerAccessCodeSent,
  type SignerAdoption,
  type SignerOutcome,
  type SignerRequestView,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { Failure } from "$lib/api/problem.ts";

export type { SignerAdoption, SignerOutcome, SignerRequestView };

/** The header the link travels in. The server's twin is in the worker's signing directory. */
export const SIGNER_LINK_HEADER = "x-signing-link";

export type SignerCall<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "failed"; readonly failure: Failure };

/** How every signer call is made: the link in its header, no cookie, no referrer. */
function asSigner(token: string) {
  return {
    headers: { [SIGNER_LINK_HEADER]: token },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    throwOnError: true,
  } as const;
}

async function outcomeOf<T>(call: () => Promise<{ data: T }>): Promise<SignerCall<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return { kind: "failed", failure: failureOf(error) };
  }
}

/** What the signer is asked to sign, and where they stand. Writes nothing. */
export function readSigning(token: string): Promise<SignerCall<SignerRequestView>> {
  return outcomeOf(() => signerReadRequest(asSigner(token)));
}

/** The document itself, as bytes for the page's own renderer. */
export function readSigningDocument(token: string): Promise<SignerCall<ArrayBuffer>> {
  return outcomeOf(async () => {
    const answer = await signerReadDocument({ ...asSigner(token), parseAs: "arrayBuffer" });
    return { data: answer.data as unknown as ArrayBuffer };
  });
}

/** Record that the signer opened the request. A second open records nothing new. */
export function openSigning(token: string): Promise<SignerCall<unknown>> {
  return outcomeOf(() => signerOpen(asSigner(token)));
}

/** Mail a fresh one-time code to the address the request was sent to. */
export function sendAccessCode(token: string): Promise<SignerCall<SignerAccessCodeSent>> {
  return outcomeOf(() => signerSendAccessCode(asSigner(token)));
}

export function checkAccessCode(token: string, code: string): Promise<SignerCall<unknown>> {
  return outcomeOf(() => signerCheckAccessCode({ ...asSigner(token), body: { code } }));
}

export function giveConsent(token: string): Promise<SignerCall<unknown>> {
  return outcomeOf(() => signerConsent(asSigner(token)));
}

export function adoptSignature(
  token: string,
  adoption: SignerAdoption,
): Promise<SignerCall<unknown>> {
  return outcomeOf(() => signerAdopt({ ...asSigner(token), body: adoption }));
}

export function finishSigning(
  token: string,
  answers: Record<string, string | boolean>,
): Promise<SignerCall<SignerOutcome>> {
  return outcomeOf(() => signerFinish({ ...asSigner(token), body: { answers } }));
}

export function declineSigning(token: string, reason: string): Promise<SignerCall<SignerOutcome>> {
  return outcomeOf(() => signerDecline({ ...asSigner(token), body: { reason } }));
}
