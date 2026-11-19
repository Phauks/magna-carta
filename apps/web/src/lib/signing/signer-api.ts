/*
 * Everything a signer's page asks of the server, for both kinds of signer: an outside signer holding
 * a link, and a colleague signing in the app on their own session. The page is one component and
 * takes a `SigningSession`; only how each call is made differs.
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
  signingAdoptMySignature,
  signingConsentMyPart,
  signingDeclineMyPart,
  signingFinishMyPart,
  signingListMyRequests,
  signingOpenMyPart,
  signingReadMyDocument,
  signingReadMyPart,
  signerAdopt,
  signerCheckAccessCode,
  signerConsent,
  signerDecline,
  signerFinish,
  signerOpen,
  signerReadDocument,
  signerReadRequest,
  signerReadSignedCopy,
  signerReadSignedCopyCertificate,
  signerReadSignedCopyDocument,
  signerSendAccessCode,
  type SignerAccessCodeSent,
  type SignerAdoption,
  type SignerOutcome,
  type SignerRequestView,
  type SignedCopyView,
} from "@magna-carta/api-client";
import { failureOf } from "$lib/api/api-client.ts";
import type { Failure } from "$lib/api/problem.ts";

export type { SignedCopyView, SignerAdoption, SignerOutcome, SignerRequestView };

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

/** What the link in the completion email opens: the title, the sender, and when it was sealed. */
export function readSignedCopy(token: string): Promise<SignerCall<SignedCopyView>> {
  return outcomeOf(() => signerReadSignedCopy(asSigner(token)));
}

/** The sealed, signed copy, or its Certificate of Completion, as bytes to save. */
export function readSignedCopyFile(
  token: string,
  which: "document" | "certificate",
): Promise<SignerCall<ArrayBuffer>> {
  return outcomeOf(async () => {
    const options = { ...asSigner(token), parseAs: "arrayBuffer" } as const;
    const answer =
      which === "document"
        ? await signerReadSignedCopyDocument(options)
        : await signerReadSignedCopyCertificate(options);
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

/** One signer's calls, whichever way they prove who they are. */
export interface SigningSession {
  /** Whether a code step can arise: only a link can ask for one. */
  readonly kind: "link" | "member";
  read(): Promise<SignerCall<SignerRequestView>>;
  readDocument(): Promise<SignerCall<ArrayBuffer>>;
  open(): Promise<SignerCall<unknown>>;
  sendAccessCode(): Promise<SignerCall<SignerAccessCodeSent>>;
  checkAccessCode(code: string): Promise<SignerCall<unknown>>;
  consent(): Promise<SignerCall<unknown>>;
  adopt(adoption: SignerAdoption): Promise<SignerCall<unknown>>;
  finish(answers: Record<string, string | boolean>): Promise<SignerCall<SignerOutcome>>;
  decline(reason: string): Promise<SignerCall<SignerOutcome>>;
}

/** An outside signer, by the link in their mail. */
export function linkSession(token: string): SigningSession {
  return {
    kind: "link",
    read: () => readSigning(token),
    readDocument: () => readSigningDocument(token),
    open: () => openSigning(token),
    sendAccessCode: () => sendAccessCode(token),
    checkAccessCode: (code) => checkAccessCode(token, code),
    consent: () => giveConsent(token),
    adopt: (adoption) => adoptSignature(token, adoption),
    finish: (answers) => finishSigning(token, answers),
    decline: (reason) => declineSigning(token, reason),
  };
}

const NO_CODE: SignerCall<never> = {
  kind: "failed",
  failure: { problem: null, request: "", failedAt: new Date(0) },
};

/** A colleague signing in the app: their session says who they are, the path says which request. */
export function memberSession(requestId: string): SigningSession {
  const path = { requestId };
  return {
    kind: "member",
    read: () => outcomeOf(() => signingReadMyPart({ path, throwOnError: true })),
    readDocument: () =>
      outcomeOf(async () => {
        const answer = await signingReadMyDocument({
          path,
          parseAs: "arrayBuffer",
          throwOnError: true,
        });
        return { data: answer.data as unknown as ArrayBuffer };
      }),
    open: () => outcomeOf(() => signingOpenMyPart({ path, throwOnError: true })),
    // A member is never asked for a code; the session already says who they are.
    sendAccessCode: () => Promise.resolve(NO_CODE),
    checkAccessCode: () => Promise.resolve(NO_CODE),
    consent: () => outcomeOf(() => signingConsentMyPart({ path, throwOnError: true })),
    adopt: (adoption) =>
      outcomeOf(() => signingAdoptMySignature({ path, body: adoption, throwOnError: true })),
    finish: (answers) =>
      outcomeOf(() => signingFinishMyPart({ path, body: { answers }, throwOnError: true })),
    decline: (reason) =>
      outcomeOf(() => signingDeclineMyPart({ path, body: { reason }, throwOnError: true })),
  };
}

/** The requests on a file still waiting on the signed-in member's signature, newest first. */
export function listMySigningRequests(fileId: string): Promise<SignerCall<string[]>> {
  return outcomeOf(async () => {
    const { data } = await signingListMyRequests({ path: { id: fileId }, throwOnError: true });
    return { data: data.requestIds };
  });
}
