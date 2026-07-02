import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// The firm-default consent axis for external AI-text detection: may this firm's text be sent to a
// third-party detector at all? Default OFF — the strictest posture; privileged content never egresses
// on an implicit yes. Read through the generic firm-setting accessor (a missing row = this default),
// enforced at the detection route before any provider call. The consent UI is a later slice.
export const externalDetectionEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "aiDetection.externalDetectionEnabled",
  schema: z.boolean(),
  defaultValue: false,
};
