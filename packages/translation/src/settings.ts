import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Whether this firm's members may send text to the translation engine at all. Default OFF: the engine
// is Google, a third party, and privileged text never leaves on an implicit yes. Read at the translate
// route before any engine call; written only by the firm's translation settings route, behind the
// same permission as the firm's other AI switches.
//
// It is its own switch and not the firm's general AI switch (`inference.aiProcessingEligibility`).
// That one asks whether content may reach a reasoning model under the platform's zero-retention
// terms; this one asks whether it may reach Google's translation service under Google's terms. A firm
// may want either without the other.
export const translationEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "translation.enabled",
  schema: z.boolean(),
  defaultValue: false,
};
