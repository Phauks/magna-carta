import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// The optional review gate. Default off keeps the frictionless capture path (draft -> billed) for a
// firm that has not opted in. Key namespaced `billing.*` so it is shareable across billing
// subsystems (time entries, costs, future).
export const approvalRequiredDefinition: FirmSettingDefinition<boolean> = {
  key: "billing.approval_required",
  schema: z.boolean(),
  defaultValue: false,
};
