/*
 * Email Inspector — a message's headers, the route it took, and what it carried, and the message
 * saved as a PDF. Read in this browser by the Rust parser compiled to WebAssembly.
 */
import MailSearch from "@lucide/svelte/icons/mail-search";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { describeType, isEmail } from "../file-facts.ts";

export const emailCapability: CapabilityModule = {
  id: "email",
  label: "Email",
  icon: MailSearch,
  permission: assertPermission("tools:emailInspector"),
  stage: "alpha",
  timing: "on-arrival",
  scope: "single",
  description: "Inspect an email file's headers, routing, and attachments.",
  awaiting: null,
  applies(file) {
    return isEmail(file)
      ? APPLIES
      : notApplicable(`${describeType(file)} is not an email message.`);
  },
  pendingAction: "Read the Message",
};
