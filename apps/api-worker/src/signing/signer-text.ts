import { operationFailed } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { signingTextCodesUndelivered } from "@magna-carta/telemetry/metrics";
import type { TextMessage, TextMessagePort } from "@magna-carta/signing/text-message";

// Texting a signer their code, and answering whether it went. A failure is counted and logged by
// its reason alone, under an Error ID the signer's page quotes: the number and the code never reach
// a log line, a metric or the answer.

export type TextDelivery =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly errorId: string };

export async function textAccessCode(input: {
  readonly port: TextMessagePort;
  readonly message: TextMessage;
  readonly logger?: Logger;
  readonly correlationId?: string;
}): Promise<TextDelivery> {
  const outcome = await input.port.send(input.message);
  if (outcome.kind === "sent") return { delivered: true };
  const errorId = newErrorId();
  input.logger?.count(signingTextCodesUndelivered.metricName, { reason: outcome.reason });
  input.logger?.log(
    operationFailed(
      { correlationId: input.correlationId ?? "", now: new Date().toISOString() },
      {
        operation: "text-send:signing-access-code",
        errorName: "TextNotSent",
        messageHead: outcome.reason,
        errorId,
      },
    ),
  );
  return { delivered: false, errorId };
}
