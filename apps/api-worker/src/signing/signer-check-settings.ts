import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { connectedOutsideServices } from "@magna-carta/signing/outside-service";
import {
  DEFAULT_SIGNER_CHECK_CHOICE,
  offeredChecks,
  SIGNER_CHECKS,
  type SignerCheck,
  type SignerCheckChoice,
  type SignerCheckReadiness,
} from "@magna-carta/signing/signer-checks";
import {
  deferredTextMessagePort,
  telnyxTextMessagePort,
  type TextMessagePort,
} from "@magna-carta/signing/text-message";
import { z } from "zod";
import type { Bindings } from "../bindings.ts";

// Which ways an outside signer may prove who they are, as this firm chose them, and what this
// deployment has ready to run them. Written only by the firm's signing settings route
// (http/routes/documents/signing-settings.ts); read there, by the send route (a request is not sent
// with a check the firm has turned off) and by the signer's code step (a text goes out only through
// a provisioned service).

const CHECK = z.enum(SIGNER_CHECKS as readonly [SignerCheck, ...SignerCheck[]]);

export const signerCheckChoiceDefinition: FirmSettingDefinition<SignerCheckChoice> = {
  key: "signing.signer_checks",
  schema: z.object({
    emailCode: z.boolean(),
    textCode: z.boolean(),
    identityCheck: z.boolean(),
    startWith: CHECK,
  }),
  defaultValue: DEFAULT_SIGNER_CHECK_CHOICE,
};

/** The port a signer's code is texted through: Telnyx when both its values are set, else none. */
export function resolveTextMessagePort(
  env: Pick<Bindings, "TELNYX_API_KEY" | "TELNYX_TEXT_FROM">,
): TextMessagePort {
  const apiKey = env.TELNYX_API_KEY?.trim() ?? "";
  const from = env.TELNYX_TEXT_FROM?.trim() ?? "";
  return apiKey === "" || from === ""
    ? deferredTextMessagePort()
    : telnyxTextMessagePort({ apiKey, from });
}

export function signerCheckReadiness(
  env: Pick<Bindings, "TELNYX_API_KEY" | "TELNYX_TEXT_FROM">,
): SignerCheckReadiness {
  return {
    textService: resolveTextMessagePort(env).engine !== "none",
    identityService: connectedOutsideServices().has("identity-check"),
  };
}

/** The checks a member may pick today. */
export async function readOfferedChecks(
  env: Pick<Bindings, "TELNYX_API_KEY" | "TELNYX_TEXT_FROM">,
  database: SqlDatabase,
): Promise<SignerCheck[]> {
  const choice = await readFirmSetting(database, signerCheckChoiceDefinition);
  return offeredChecks(choice, signerCheckReadiness(env));
}
