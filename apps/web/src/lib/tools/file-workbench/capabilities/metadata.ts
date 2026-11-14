/*
 * Metadata Inspector & Scrubber — the fields a document carries that nobody put there on purpose.
 *
 * Inspection is cheap and reversible; scrubbing writes a new file, so the two sit on either side of
 * the class boundary. Only formats that carry metadata worth reading offer it: a plain-text file
 * has none, and saying so is better than an empty table.
 */
import FileSearch from "@lucide/svelte/icons/file-search";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { detectedLabelOf, describeType, isImage, isOfficeDocument, isPdf } from "../file-facts.ts";

/** Formats whose containers hold document properties or EXIF worth inspecting. */
function carriesMetadata(label: string | null): boolean {
  return label === "email" || label === "rtf";
}

export const metadataCapability: CapabilityModule = {
  id: "metadata",
  label: "Metadata",
  icon: FileSearch,
  permission: assertPermission("tools:metadataScrubber"),
  stage: "soon",
  timing: "on-arrival",
  scope: "single",
  description: "Inspect and strip hidden metadata from a file.",
  awaiting: "metadata reading",
  applies(file) {
    const label = detectedLabelOf(file);
    if (label === null) return APPLIES;
    if (isPdf(file) || isOfficeDocument(file) || isImage(file) || carriesMetadata(label)) {
      return APPLIES;
    }
    return notApplicable(`${describeType(file)} carries no embedded metadata to read.`);
  },
  pendingAction: "Inspect the Metadata",
};
