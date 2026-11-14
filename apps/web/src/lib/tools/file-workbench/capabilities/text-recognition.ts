/*
 * Text Recognition — turning a picture of a page into text you can select.
 *
 * Applies to images and to PDFs, since a PDF is as often a wrapper around scans as it is a document
 * with a text layer. A format that already carries text has nothing to recognize.
 */
import ScanText from "@lucide/svelte/icons/scan-text";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { carriesText, describeType, isImage, isPdf } from "../file-facts.ts";

export const TEXT_RECOGNITION_CAPABILITY = "text-recognition";

export const textRecognitionCapability: CapabilityModule = {
  id: TEXT_RECOGNITION_CAPABILITY,
  label: "Text Recognition",
  icon: ScanText,
  permission: assertPermission("tools:ocr"),
  stage: "soon",
  timing: "on-request",
  scope: "single",
  description: "Extract selectable text from a scanned document or image.",
  awaiting: "text recognition",
  applies(file) {
    if (isImage(file) || isPdf(file)) return APPLIES;
    if (carriesText(file)) {
      return notApplicable(
        `${describeType(file)} already carries selectable text. Recognition is for scans and images.`,
      );
    }
    return notApplicable(`There is no page image in ${describeType(file)} to read.`);
  },
  pendingAction: "Recognize the Text",
};
