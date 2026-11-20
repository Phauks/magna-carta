import { maskedNumber } from "@magna-carta/signing/signer-checks";
import type { TextMessagePort } from "@magna-carta/signing/text-message";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../bindings.ts";
import { sendMessage } from "../email-delivery.ts";
import type { SendEmail } from "../email-port.ts";
import { resolveTextMessagePort } from "./signer-check-settings.ts";
import { maskedAddress } from "./signer-contract.ts";
import { ACCESS_CODE_LIFETIME_MINUTES, type SignerView } from "./signer-service.ts";
import { textAccessCode } from "./signer-text.ts";
import {
  SIGNING_ACCESS_CODE_MESSAGE_CLASS,
  accessCodeEmail,
  accessCodeText,
} from "./signing-mail.ts";

// Sending a signer the code they were just issued, by the way the sender chose: a text to their
// mobile number, or an email to their address. Answers where it went, shown with most of it hidden,
// or which way failed and the Error ID the failure was recorded under. The digits are never logged.

export type AccessCodeDelivery =
  | { readonly delivered: true; readonly sentTo: string }
  | { readonly delivered: false; readonly channel: "email" | "text"; readonly errorId: string };

export async function deliverAccessCode(input: {
  readonly env: Bindings;
  readonly sendEmail: (env: Bindings) => SendEmail;
  readonly signer: SignerView["signer"];
  readonly firmName: string;
  readonly digits: string;
  readonly logger?: Logger;
  readonly correlationId: string;
  /** The text port; the deployment's own when absent. A test hands in a fake. */
  readonly textPort?: TextMessagePort;
}): Promise<AccessCodeDelivery> {
  const { signer, firmName, digits } = input;
  const minutes = ACCESS_CODE_LIFETIME_MINUTES;
  const logging = input.logger === undefined ? {} : { logger: input.logger };
  if (signer.codeChannel === "text" && signer.mobileNumber !== null) {
    const texted = await textAccessCode({
      port: input.textPort ?? resolveTextMessagePort(input.env),
      message: {
        to: signer.mobileNumber,
        text: accessCodeText({ firmName, code: digits, minutes }),
      },
      ...logging,
      correlationId: input.correlationId,
    });
    return texted.delivered
      ? { delivered: true, sentTo: maskedNumber(signer.mobileNumber) }
      : { delivered: false, channel: "text", errorId: texted.errorId };
  }
  const { subject, text } = accessCodeEmail({ firmName, code: digits, minutes });
  const mailed = await sendMessage({
    send: input.sendEmail(input.env),
    surface: "signing.access-code",
    ...logging,
    correlationId: input.correlationId,
    message: { to: signer.email, subject, text, messageClass: SIGNING_ACCESS_CODE_MESSAGE_CLASS },
  });
  return mailed.delivered
    ? { delivered: true, sentTo: maskedAddress(signer.email) }
    : { delivered: false, channel: "email", errorId: mailed.errorId };
}
