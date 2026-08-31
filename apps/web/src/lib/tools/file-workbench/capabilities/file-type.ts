/*
 * File Type Verifier — what the bytes say this file is, against what its name claims.
 *
 * Runs on arrival, because "what is this, really" is the first question the workbench exists to
 * answer and every other capability's applicability turns on it.
 */
import FileCheck from "@lucide/svelte/icons/file-check";
import { assertPermission } from "@magna-carta/access-control/registry";
import FileTypePanel from "../panels/file-type-panel.svelte";
import { APPLIES, type CapabilityModule } from "../capability.ts";
import { fileTypeOf } from "../file-facts.ts";
import { FILE_TYPE_CAPABILITY } from "../workbench-file.ts";

export const fileTypeCapability: CapabilityModule = {
  id: FILE_TYPE_CAPABILITY,
  label: "Type",
  icon: FileCheck,
  permission: assertPermission("tools:fileTypeVerifier"),
  stage: "alpha",
  timing: "on-arrival",
  scope: "single",
  description: "Confirm what a file really is, whatever its extension says.",
  awaiting: null,
  applies: () => APPLIES,
  summary(file) {
    const identified = fileTypeOf(file);
    if (identified === null) return null;
    const { report } = identified;
    if (report.extensionMatch === "mismatch") {
      return {
        label: "What it is",
        value: `${report.detectedLabel}, named ".${report.claimedExtension}"`,
        tone: "danger",
      };
    }
    return { label: "What it is", value: report.detectedLabel };
  },
  pendingAction: "Identify This File",
  panel: FileTypePanel,
};
