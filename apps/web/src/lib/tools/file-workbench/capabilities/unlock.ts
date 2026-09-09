/*
 * File Decryption & Recovery — opening a document whose password you have, and starting a search
 * for one you do not.
 *
 * BOTH HALVES LIVE ON THE WORKBENCH; only their SHAPE differs. Unlocking with a known password is
 * one request and an answer in seconds, so it runs right here in the panel. Recovering an unknown
 * one is a search that can run for hours on a cost-tier ladder — a job that outlives its own input,
 * unlike this panel's file, which the reader may discard the moment they press Recover. So the
 * panel starts the job and hands off to a screen addressed by the job's own id
 * (/tools/file-workbench/recovery/[jobId]), which the reader can leave and come back to.
 *
 * NEITHER OPERATION RETAINS THE FILE. Unlock's request and response both carry it once, over the
 * one call the reader asked for; recovery's coordinator receives only the extracted hash, never the
 * bytes. See docs/user/features/file-unlock-password-recovery.md for what the reader is told.
 */
import LockOpen from "@lucide/svelte/icons/lock-open";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, notApplicable, type CapabilityModule } from "../capability.ts";
import { canBePasswordProtected, describeType, detectedLabelOf } from "../file-facts.ts";
import type { WorkbenchFile } from "../workbench-file.ts";

export const unlockCapability: CapabilityModule = {
  id: "unlock",
  label: "Unlock",
  icon: LockOpen,
  permission: assertPermission("tools:decryption"),
  stage: "beta",
  timing: "on-request",
  scope: "single",
  description: "Unlock a protected file or recover its password.",
  awaiting: null,
  applies(file) {
    return canBePasswordProtected(file)
      ? APPLIES
      : notApplicable(`${describeType(file)} cannot carry a password.`);
  },
  pendingAction: "Unlock This File",
};

/**
 * The three containers the decryption engine reads, in the vocabulary the route answers with. Null
 * means the workbench thinks this file COULD be locked (it is a document or an archive) but not one
 * this engine opens — legacy binary Office and every archive format but zip today. The panel says so
 * plainly rather than letting the reader submit and learn it from a 400.
 */
export type UnlockableFormat = "pdf" | "zip" | "ooxml";

const OOXML_LABELS: ReadonlySet<string> = new Set(["docx", "xlsx", "pptx"]);

export function unlockableFormatOf(file: WorkbenchFile): UnlockableFormat | null {
  const label = detectedLabelOf(file);
  if (label === "pdf") return "pdf";
  if (label === "zip") return "zip";
  if (label !== null && OOXML_LABELS.has(label)) return "ooxml";
  return null;
}
