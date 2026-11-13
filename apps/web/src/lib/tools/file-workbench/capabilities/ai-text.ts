/*
 * AI-Text Detection — an estimate of whether a passage was machine-written.
 *
 * The only capability that sends content OUTSIDE the firm, which is why it never runs on arrival
 * and never runs across a selection. The disclosure is decided per file, at the point of action.
 *
 * It also reads text, not files: the route takes a passage. Against a document, something has to
 * extract the text first, and that is a second decision rather than a step this capability takes on
 * a person's behalf. A file with no text layer therefore says so and points at Text Recognition.
 */
import Sparkles from "@lucide/svelte/icons/sparkles";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { carriesText, describeType, isImage, isPdf } from "../file-facts.ts";

export const aiTextCapability: CapabilityModule = {
  id: "ai-text",
  label: "AI Text",
  icon: Sparkles,
  permission: assertPermission("tools:aiTextDetection"),
  stage: "soon",
  timing: "on-request",
  scope: "single",
  description: "Estimate whether a passage was written by AI.",
  awaiting: "text extraction",
  applies(file) {
    if (carriesText(file)) return APPLIES;
    if (isImage(file) || isPdf(file)) {
      return notApplicable(
        "There's no text here yet. Run Text Recognition first, then decide whether to send the result outside the firm.",
      );
    }
    return notApplicable(`There is no readable text in ${describeType(file)}.`);
  },
  pendingAction: "Check This Document",
};
