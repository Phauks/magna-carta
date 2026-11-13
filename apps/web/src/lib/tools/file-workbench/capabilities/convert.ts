/*
 * File Converter — a file, or a whole selection of them, turned into another format.
 *
 * The one capability whose scope is the SELECTION rather than the file in focus: bulk conversion is
 * a real need (a production arrives as sixty scans that all have to become PDFs), and a surface
 * that converts one at a time makes a person repeat themselves sixty times.
 */
import FileCog from "@lucide/svelte/icons/file-cog";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { conversionTargetsFor } from "../conversion-targets.ts";
import { describeType, detectedLabelOf } from "../file-facts.ts";

export const convertCapability: CapabilityModule = {
  id: "convert",
  label: "Convert",
  icon: FileCog,
  permission: assertPermission("tools:fileConverter"),
  stage: "soon",
  timing: "on-request",
  scope: "selection",
  description: "Convert a file from one format to another.",
  awaiting: "file conversion",
  applies(file) {
    const targets = conversionTargetsFor(detectedLabelOf(file));
    return targets.length > 0
      ? APPLIES
      : notApplicable(`Nothing converts from ${describeType(file)}.`);
  },
  summary(file) {
    const targets = conversionTargetsFor(detectedLabelOf(file));
    if (targets.length === 0) return null;
    return {
      label: "Converts to",
      value: targets.map((format) => format.label).join(", "),
    };
  },
  pendingAction: "Convert the Selection",
};
