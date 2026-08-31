/*
 * Overview — the synthesis, and the tab a file opens on.
 *
 * Deliberately NOT a member of the capability registry. It is not one more thing you can do with a
 * file; it is what every other capability already found, gathered. Keeping it out of the array is
 * also what lets its panel read the registry without the two importing each other.
 */
import LayoutList from "@lucide/svelte/icons/layout-list";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, type CapabilityModule } from "./capability.ts";

export const OVERVIEW_CAPABILITY = "overview";

export const overviewCapability: CapabilityModule = {
  id: OVERVIEW_CAPABILITY,
  label: "Overview",
  icon: LayoutList,
  permission: assertPermission("tools:fileWorkbench"),
  stage: "alpha",
  timing: "on-arrival",
  scope: "single",
  description: "Everything the workbench has read about this file.",
  awaiting: null,
  applies: () => APPLIES,
  pendingAction: "Read This File",
};
