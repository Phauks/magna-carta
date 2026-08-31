/*
 * File Decryption & Recovery — opening a document you have the password for.
 *
 * Only the KNOWN-password half lives on the workbench. Recovering an unknown password is a search
 * that runs for days on a cost tier ladder, and this surface holds bytes for hours and then deletes
 * them: a job that outlives its own input belongs on a screen addressed by its own job, which the
 * panel hands off to. The handoff carries the extracted hash and the file's digest, never the file.
 */
import LockOpen from "@lucide/svelte/icons/lock-open";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { canBePasswordProtected, describeType } from "../file-facts.ts";

export const unlockCapability: CapabilityModule = {
  id: "unlock",
  label: "Unlock",
  icon: LockOpen,
  permission: assertPermission("tools:decryption"),
  stage: "soon",
  timing: "on-request",
  scope: "single",
  description: "Unlock a protected file or recover its password.",
  awaiting: "the decryption engine reaching this surface",
  applies(file) {
    return canBePasswordProtected(file)
      ? APPLIES
      : notApplicable(`${describeType(file)} cannot carry a password.`);
  },
  pendingAction: "Unlock This File",
};
