import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import { sendMessage } from "../email-delivery.ts";
import type { SendEmail } from "../email-port.ts";
import { hashSignerSecret, mintSignerLink, signerLinkSecret } from "./signer-link.ts";
import { setSignerLinkStatement } from "./signer-statements.ts";
import {
  SIGNING_REMINDER_MESSAGE_CLASS,
  SIGNING_REQUEST_MESSAGE_CLASS,
  lastDayOf,
  signingReminderEmail,
  signingRequestEmail,
} from "./signing-mail.ts";
import type { SigningRequestRow, SigningSignerRow } from "./statements.ts";

// Telling outside signers it is their turn: the digest of each one's link written in the same batch
// that marks them asked, and the mail sent only after that batch commits, so nobody is mailed a link
// the signer lane would refuse. A colleague who signs in the firm is never mailed a link.

function outside(signers: readonly SigningSignerRow[]): SigningSignerRow[] {
  return signers.filter((signer) => signer.attributionLevel !== "firm-authenticated");
}

/** The statements recording each outside signer's link digest at their current version. */
export async function linkStatements(
  database: SqlDatabase,
  key: string,
  firmId: FirmId,
  signers: readonly SigningSignerRow[],
  now: string,
): Promise<SqlStatement[]> {
  return await Promise.all(
    outside(signers).map(async (signer) =>
      setSignerLinkStatement(
        database,
        signer.id,
        await hashSignerSecret(
          await signerLinkSecret(key, firmId, signer.id, signer.secretVersion),
        ),
        now,
      ),
    ),
  );
}

export interface SignerMailing {
  readonly send: SendEmail;
  readonly key: string;
  readonly firmId: FirmId;
  readonly firmName: string;
  readonly senderName: string;
  readonly origin: string;
  readonly logger?: Logger;
  readonly correlationId?: string;
}

/**
 * Mail each outside signer their link, after the commit. A failed delivery is recorded by the
 * delivery guard with an Error ID and does not undo the commit: the member sees the signer as asked
 * and can send a reminder, which mails the same link again.
 */
export async function mailSigners(
  mailing: SignerMailing,
  request: SigningRequestRow,
  signers: readonly SigningSignerRow[],
  kind: "request" | "reminder",
): Promise<{ readonly failed: number }> {
  let failed = 0;
  for (const signer of outside(signers)) {
    const token = await mintSignerLink(mailing.key, {
      firmId: mailing.firmId,
      requestId: request.id,
      signerId: signer.id,
      secretVersion: signer.secretVersion,
      expiresAt: request.expiresAt,
    });
    const facts = {
      firmName: mailing.firmName,
      senderName: mailing.senderName,
      subject: request.subject,
      message: request.message,
      title: request.title,
      lastDay: lastDayOf(request.expiresAt),
      origin: mailing.origin,
      token,
      needsCode: signer.attributionLevel === "access-code",
    };
    const { subject, text } =
      kind === "request" ? signingRequestEmail(facts) : signingReminderEmail(facts);
    const delivery = await sendMessage({
      send: mailing.send,
      surface: "signing.signers",
      ...(mailing.logger === undefined ? {} : { logger: mailing.logger }),
      ...(mailing.correlationId === undefined ? {} : { correlationId: mailing.correlationId }),
      message: {
        to: signer.email,
        subject,
        text,
        messageClass:
          kind === "request" ? SIGNING_REQUEST_MESSAGE_CLASS : SIGNING_REMINDER_MESSAGE_CLASS,
      },
    });
    if (!delivery.delivered) failed += 1;
  }
  return { failed };
}
