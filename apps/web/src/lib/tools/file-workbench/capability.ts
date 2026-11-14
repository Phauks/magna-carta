/*
 * The capability contract — what one thing the workbench can do with a file has to declare.
 *
 * ADDING A CAPABILITY IS TWO STEPS: write a module that satisfies this interface, then add it to
 * the array in capabilities.ts. Nothing else is wired. The tab strip, the permission gate, the
 * Overview summary and the bulk-action set all derive from the registry, so a capability that is
 * in the array is complete everywhere and one that is not is absent everywhere.
 *
 * The Overview is deliberately NOT a hand-written list of the other capabilities. Each module
 * contributes its own `summary` row and the Overview renders whatever the registry hands it, so a
 * new capability appears there without the Overview being edited at all.
 *
 * Capabilities are not peers, and the difference is `runs`: the cheap, reversible readings run the
 * moment a file arrives; anything that writes a new file, costs money, or discloses content waits
 * to be asked. A scan verdict never removes a capability — a file you do not trust is exactly the
 * kind this workbench exists for, so a flagged file is marked and still gets every capability.
 */
import type { Component } from "svelte";
import type { Permission } from "@magna-carta/access-control/registry";
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import type { WorkbenchFile } from "./workbench-file.ts";

/** Whether a capability has anything to do on a file, and the plain reason when it does not. */
export type Applicability =
  | { readonly applies: true }
  | { readonly applies: false; readonly reason: string };

export const APPLIES: Applicability = { applies: true };

/** Shorthand for the common "nothing to do here, and here is why" answer. */
export function notApplicable(reason: string): Applicability {
  return { applies: false, reason };
}

/** When a capability does its work, which is the difference between the classes of capability. */
export type CapabilityTiming =
  /** Cheap, in-house, changes nothing. Runs as the file arrives, without being asked. */
  | "on-arrival"
  /** Writes a new file, costs money, or sends content somewhere. Waits to be asked. */
  | "on-request";

/** How many files a capability acts on at once. */
export type CapabilityScope =
  /** Reads or reports on exactly the file in focus. */
  | "single"
  /** Acts on every selected file, so a bulk run is one gesture. Conversion is the reason this exists. */
  | "selection";

/** One row a capability contributes to the Overview. Returning null keeps it off the summary. */
export interface SummaryRow {
  readonly label: string;
  /** Plain text, already resolved. A row that would read as a blank returns null instead. */
  readonly value: string;
  /**
   * Draws the eye where the reading is not the ordinary one. The design system's own tone
   * vocabulary, so a row carrying a status word takes the tone the status register gave it rather
   * than a second opinion about what colour that word is.
   */
  readonly tone?: BadgeVariant;
}

/** The props every capability panel receives. */
export interface CapabilityPanelProps {
  /** The file in focus. */
  readonly file: WorkbenchFile;
  /** For a `selection`-scoped capability, every selected file; otherwise just the one in focus. */
  readonly files: readonly WorkbenchFile[];
  /**
   * Move to another capability. A panel that finds the next step is somewhere else says so and
   * takes the reader there, rather than naming a tab and leaving them to find it.
   */
  readonly onOpenCapability?: (capability: CapabilityModule) => void;
  /**
   * Put new files on the bench beside this one: an email's attachment, a disarmed copy. Absent in
   * a host that cannot take files, and a panel then offers a download instead.
   */
  readonly onAddFiles?: (files: readonly File[]) => void;
}

export interface CapabilityModule {
  /** Stable, kebab-case. It keys the outcome bag and appears in the address as `?capability=`. */
  readonly id: string;
  /** Tab label. Title case, per the standing copy rule. */
  readonly label: string;
  readonly icon: Component;
  /** The tool permission this capability belongs to. A member without it never sees the tab. */
  readonly permission: Permission;
  /** How finished this capability's surface is. Below `ready` the panel says what it waits on. */
  readonly stage: MaturityStage;
  readonly timing: CapabilityTiming;
  readonly scope: CapabilityScope;
  /** One line, plain language, for the tab's tooltip and the pending panel. */
  readonly description: string;
  /**
   * What this capability needs before it can do its work for real, as a noun phrase. Null means it
   * IS served: it has a panel in capability-panels.ts and renders real findings. A capability with
   * an `awaiting` gets the standard pending treatment instead.
   */
  readonly awaiting: string | null;
  /** Whether there is anything to do on this file, and the reason when there is not. */
  applies(file: WorkbenchFile): Applicability;
  /** The Overview row this capability contributes, or null to contribute none. */
  summary?(file: WorkbenchFile): SummaryRow | null;
  /**
   * The run control's real words while there is no panel yet: "Convert the Selection". The standing
   * rule renders a not-yet-served capability's control for real and disabled, and this is what it
   * says on it.
   */
  readonly pendingAction: string;
}

/*
 * WHY THE PANEL IS NOT ON THE MODULE. A capability's panel is a Svelte component built on the
 * design system, and the design system is built on bits-ui — which golden rule 2 confines to
 * `packages/design-system/src`, strictly enough that even a test config naming it fails the gate.
 * Hanging the component off the module would drag every panel into the registry, and the registry
 * is exactly what the fitness tests import to check that the capabilities are complete and that a
 * scan verdict changes nothing.
 *
 * So the decision layer (this file, capabilities.ts, and every module in capabilities/) is
 * DOM-free and testable, and the id-to-component map lives on its own in capability-panels.ts,
 * imported only by the component that renders it. Which capability has a real surface is still
 * declared here, in one place a test can read: `awaiting === null`.
 */
