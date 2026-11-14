/*
 * File Repair & Salvage — reading what can still be read out of a damaged file.
 *
 * Always offered. Whether a file is damaged is exactly what a person comes here unsure about, so a
 * capability that hid itself until the damage was already known would never be there when it was
 * wanted. Repair works on a copy; the original is never modified.
 */
import Wrench from "@lucide/svelte/icons/wrench";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, type CapabilityModule } from "../capability.ts";

export const repairCapability: CapabilityModule = {
  id: "repair",
  label: "Repair",
  icon: Wrench,
  permission: assertPermission("tools:fileRepair"),
  stage: "soon",
  timing: "on-request",
  scope: "single",
  description: "Repair and salvage a damaged or corrupted file.",
  awaiting: "file repair",
  applies: () => APPLIES,
  pendingAction: "Repair a Copy",
};
