import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// Per-firm locations configuration, read through the generic firm-setting accessor.

// The firm's default Location: the fallback a location-scoped numbering scheme resolves against when a
// matter names no Location, and the one Location that cannot be closed while it holds this role. Null
// until an admin sets one; the settings UI is a later slice.
export const firmDefaultLocationDefinition: FirmSettingDefinition<string | null> = {
  key: "locations.firmDefaultLocationId",
  schema: z.string().nullable(),
  defaultValue: null,
};
