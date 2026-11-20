/*
 * PDF: what this PDF is, and the PDF Editor's tools, each a press away.
 *
 * The reading is cheap and in this browser (pages, form, password, Bates labels, read by the
 * firm's own engine in a worker), so it runs as the tab is opened. The tools themselves live in
 * the PDF Editor: Open hands the bench file to it, and what the editor makes comes back to the
 * bench as a new file. Nothing is added to a matter.
 *
 * Gated on the bench's own permission rather than one of its own. The PDF Editor on a matter file
 * asks for no tool permission, so a member who can use the bench can use the editor on it.
 */
import FileText from "@lucide/svelte/icons/file-text";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { describeType, detectedLabelOf, isPdf } from "../file-facts.ts";

export const PDF_CAPABILITY = "pdf";

export const pdfCapability: CapabilityModule = {
  id: PDF_CAPABILITY,
  label: "PDF",
  icon: FileText,
  permission: assertPermission("tools:fileWorkbench"),
  stage: "beta",
  timing: "on-arrival",
  scope: "single",
  description: "Read a PDF's pages, form and protection, and open it in the PDF Editor.",
  awaiting: null,
  applies(file) {
    // Until the file is identified the tab stays offered, as every reading tab does.
    if (detectedLabelOf(file) === null || isPdf(file)) return APPLIES;
    return notApplicable(`${describeType(file)} is not a PDF.`);
  },
  pendingAction: "Open in PDF Editor",
};
