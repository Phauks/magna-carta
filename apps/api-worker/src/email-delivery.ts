// THE GUARD EVERY OUTBOUND SEND ON A JOINING PATH GOES THROUGH.
//
// The port throws when a send fails, and that is the right contract — silent email loss is the one
// unacceptable outcome, so the adapter refuses to swallow it. What was missing is anybody catching
// it. A joining route that sends after committing its work answered 500 when the send threw, which
// is wrong three ways at once: the work is committed and the 500 says otherwise, the caller is told
// nothing they can act on, and the failure reaches observability only as an unhandled exception
// carrying whatever the mail provider put in its message.
//
// This is what a caller uses instead. It NEVER throws, it counts the failure, it correlates it with
// an Error ID the caller can put in front of a person, and — the property that has to survive every
// future edit — it records the message CLASS and nothing else. There is no field here a subject, a
// body, a link, a token, or an address could occupy, which is why the failure is safe to log at all.
//
// Cloudflare Email Sending is in beta, where a destination may need verifying before it will accept
// a send at all, so "the adapter throws" is an ordinary state on the day mail is switched on rather
// than a rare one.
import { operationFailed } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { emailDeliveryFailed } from "@magna-carta/telemetry/metrics";
import { MESSAGE_HEAD_LENGTH } from "@magna-carta/telemetry/operation";
import type { SendEmail } from "./email-port.ts";

/**
 * What a guarded send answers with. A failure carries the Error ID it was recorded under, so the
 * caller quotes the same handle the operator will search for — the caller never mints a second one.
 */
export type EmailDelivery =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly errorId: string };

/**
 * Run a send, and answer whether it went.
 *
 * IT TAKES AN ATTEMPT RATHER THAN A MESSAGE because not every send on these paths is a direct port
 * call: a password reset is sent by Better Auth from inside its own endpoint, and the only thing a
 * caller can wrap there is the call. `sendMessage` below is the sugar for the ordinary case.
 *
 * `surface` is a closed label naming the path that asked (a route template or a consumer name) and
 * `messageClass` the port's own non-content tag — both are dimensions, so both must stay enum-like
 * and neither may ever be derived from anything a caller supplies.
 */
export async function deliverEmail(input: {
  readonly attempt: () => Promise<unknown>;
  readonly messageClass: string;
  readonly surface: string;
  /** The request-scoped logger when there is one. A missing logger loses the signal, never the send. */
  readonly logger?: Logger;
  /** Groups this failure with the request or pass that caused it, when the caller holds an id. */
  readonly correlationId?: string;
}): Promise<EmailDelivery> {
  const messageClass = input.messageClass;
  try {
    await input.attempt();
    return { delivered: true };
  } catch (caught) {
    const errorId = newErrorId();
    const error = caught instanceof Error ? caught : new Error(String(caught));
    input.logger?.count(emailDeliveryFailed.metricName, {
      surface: input.surface,
      messageClass,
    });
    input.logger?.log(
      operationFailed(
        {
          correlationId: input.correlationId ?? "",
          now: new Date().toISOString(),
        },
        {
          // The message class, not the recipient and not the subject: this label is the whole
          // description of what did not go out.
          operation: `email-send:${messageClass}`,
          errorName: error.name,
          // The provider's own words, capped at the shared redaction length and scrubbed again by
          // the logger. A rejection can quote the address it rejected, which is why the cap and the
          // scrub both apply here rather than the raw message being logged.
          messageHead: error.message.slice(0, MESSAGE_HEAD_LENGTH),
          errorId,
        },
      ),
    );
    return { delivered: false, errorId };
  }
}

/** The ordinary case: one message through the port, guarded. The class comes off the message. */
export function sendMessage(input: {
  readonly send: SendEmail;
  readonly message: Parameters<SendEmail>[0];
  readonly surface: string;
  readonly logger?: Logger;
  readonly correlationId?: string;
}): Promise<EmailDelivery> {
  return deliverEmail({
    attempt: () => input.send(input.message),
    messageClass: input.message.messageClass ?? "unspecified",
    surface: input.surface,
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}
