/*
 * THE REGISTRY. Every capability the workbench offers, in the order the tab strip lists them.
 *
 * ADDING A CAPABILITY: write the module in `capabilities/`, import it, and put it in this array.
 * Nothing else is wired. The tab strip, the permission gate, the bulk-action set and the Overview's
 * summary all derive from this list, so a capability in the array is complete everywhere and one
 * that is not is absent everywhere.
 *
 * THE ORDER IS THE ARGUMENT. Capabilities are not peers, and the list says so: the cheap readings
 * that run the moment a file arrives come first, then the ones that write a new file when asked,
 * then the two that need a decision of their own — Unlock, which produces a readable copy of a
 * protected document, and AI Text, which is the only one that sends content outside the firm.
 */
import type { Permission } from "@magna-carta/access-control/registry";
import type { CapabilityModule, SummaryRow } from "./capability.ts";
import type { WorkbenchFile } from "./workbench-file.ts";
import { fileTypeCapability } from "./capabilities/file-type.ts";
import { hashCapability } from "./capabilities/hash.ts";
import { malwareScanCapability } from "./capabilities/malware-scan.ts";
import { metadataCapability } from "./capabilities/metadata.ts";
import { emailCapability } from "./capabilities/email.ts";
import { convertCapability } from "./capabilities/convert.ts";
import { repairCapability } from "./capabilities/repair.ts";
import { textRecognitionCapability } from "./capabilities/text-recognition.ts";
import { unlockCapability } from "./capabilities/unlock.ts";
import { aiTextCapability } from "./capabilities/ai-text.ts";

export const CAPABILITIES: readonly CapabilityModule[] = [
  // Cheap, in-house, reversible. These run as a file arrives.
  fileTypeCapability,
  hashCapability,
  malwareScanCapability,
  metadataCapability,
  emailCapability,
  // Asked for, and each produces a new file beside the original.
  convertCapability,
  repairCapability,
  textRecognitionCapability,
  // A decision of their own, every time, per file.
  unlockCapability,
  aiTextCapability,
];

/** The capabilities that read a file the moment it lands, without being asked. */
export const ARRIVAL_CAPABILITIES: readonly CapabilityModule[] = CAPABILITIES.filter(
  (capability) => capability.timing === "on-arrival",
);

/** The capability with this id, or null. The address carries one in `?capability=`. */
export function capabilityById(id: string | null): CapabilityModule | null {
  if (id === null) return null;
  return CAPABILITIES.find((capability) => capability.id === id) ?? null;
}

/** The capabilities a member holding `permissions` can see. Hide in place; nothing reorders. */
export function permittedCapabilities(
  permissions: ReadonlySet<Permission>,
): readonly CapabilityModule[] {
  return CAPABILITIES.filter((capability) => permissions.has(capability.permission));
}

/**
 * The Overview's rows, contributed by the capabilities themselves.
 *
 * This is why the Overview never needs editing: a capability that knows something worth summarizing
 * returns a row, and the Overview renders whatever it is handed. Adding a capability adds its row.
 * A capability that does not apply to this file contributes nothing rather than an empty row.
 */
export function summaryRowsFor(
  file: WorkbenchFile,
  capabilities: readonly CapabilityModule[] = CAPABILITIES,
): readonly SummaryRow[] {
  return capabilities
    .filter((capability) => capability.applies(file).applies)
    .map((capability) => capability.summary?.(file) ?? null)
    .filter((row): row is SummaryRow => row !== null);
}
