// The text-message port a signer's code is sent through, and its Telnyx adapter.
//
// The signing lane asks for one thing: send these words to this number. Which provider carries them
// is the deployment's choice, made by provisioning it; with nothing provisioned the deferred port
// answers `not-configured` and the firm's settings say the text service is not ready, so no member
// can pick a text code in the first place.
//
// WHAT IS SENT is the number and the message: the code, the firm's name and how long the code
// works. No document title, no matter, no signer name. The provider learns that the firm texted a
// code to a number, and nothing the firm holds about the person rides along with it.
//
// THE TRANSPORT IS INJECTED, so a test drives the adapter with a canned answer and the Worker hands
// in its own fetch. Nothing here reads `env`, and nothing here logs: the number and the code never
// reach a log line, and a failure is reported as a reason the caller can count.
//
// Telnyx reference: https://developers.telnyx.com/docs/messaging/messages/send-message.md

export interface TextMessage {
  /** E.164: a `+` and the digits. */
  readonly to: string;
  readonly text: string;
}

/** Why a text was not sent, as a label safe to count. */
export type TextFailureReason =
  | "not-configured"
  | "transport"
  | "refused"
  | "number-not-allowed"
  | "rate-limited"
  | "malformed";

export type TextOutcome =
  | { readonly kind: "sent" }
  | { readonly kind: "failed"; readonly reason: TextFailureReason };

export interface TextMessagePort {
  /** Which provider this is, for System Status and the settings answer. Never a credential. */
  readonly engine: "telnyx" | "none";
  send(message: TextMessage): Promise<TextOutcome>;
}

/** The port when no provider is provisioned: nothing is ever sent. */
export function deferredTextMessagePort(): TextMessagePort {
  return {
    engine: "none",
    send: () => Promise.resolve({ kind: "failed", reason: "not-configured" }),
  };
}

export interface TelnyxTextCredentials {
  readonly apiKey: string;
  /** The Telnyx number texts are sent from, in E.164. */
  readonly from: string;
}

const MESSAGES_URL = "https://api.telnyx.com/v2/messages";

/** Telnyx's status for a refused send, read into a reason. Exported for its test. */
export function reasonForTelnyxStatus(status: number): TextFailureReason {
  if (status === 429) return "rate-limited";
  // 403 is the number not being enabled for messaging, or not registered for business texting in
  // the United States; 422 is a destination Telnyx will not send to.
  if (status === 403 || status === 422) return "number-not-allowed";
  return "refused";
}

export function telnyxTextMessagePort(
  credentials: TelnyxTextCredentials,
  transport: typeof fetch = fetch,
): TextMessagePort {
  return {
    engine: "telnyx",
    async send(message: TextMessage): Promise<TextOutcome> {
      let response: Response;
      try {
        response = await transport(MESSAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ from: credentials.from, to: message.to, text: message.text }),
        });
      } catch {
        return { kind: "failed", reason: "transport" };
      }
      if (!response.ok) return { kind: "failed", reason: reasonForTelnyxStatus(response.status) };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "failed", reason: "malformed" };
      }
      const data = (body as { data?: { id?: unknown } } | null)?.data;
      return typeof data?.id === "string"
        ? { kind: "sent" }
        : { kind: "failed", reason: "malformed" };
    },
  };
}
