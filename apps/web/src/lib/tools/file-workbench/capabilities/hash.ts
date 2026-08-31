/*
 * File Hash & Integrity — the digests, and the comparison against one somebody sent you.
 *
 * Runs on arrival: it reads bytes and writes nothing, which is the definition of the cheap class.
 */
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import { assertPermission } from "@magna-carta/access-control/registry";
import { APPLIES, type CapabilityModule } from "../capability.ts";
import type { BrowserDigests } from "../digest.ts";
import { outcomeFor } from "../workbench-file.ts";

export const HASH_CAPABILITY = "hash";

/** How much of a digest reads at a glance. The full value is always one row away in the panel. */
function abbreviate(digest: string): string {
  return `${digest.slice(0, 8)}…${digest.slice(-4)}`;
}

export const hashCapability: CapabilityModule = {
  id: HASH_CAPABILITY,
  label: "Hash",
  icon: Fingerprint,
  permission: assertPermission("tools:fileIntegrity"),
  stage: "alpha",
  timing: "on-arrival",
  scope: "single",
  description: "Compute a file's hash and confirm it hasn't changed.",
  awaiting: null,
  applies: () => APPLIES,
  summary(file) {
    const outcome = outcomeFor<BrowserDigests>(file, HASH_CAPABILITY);
    if (outcome.kind !== "result") return null;
    return { label: "SHA-256", value: abbreviate(outcome.value["SHA-256"]) };
  },
  pendingAction: "Compute the Digests",
};
