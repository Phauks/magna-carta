/*
 * Which component draws which capability's findings.
 *
 * Separate from the registry on purpose: a panel is a design-system component and therefore reaches
 * bits-ui, which golden rule 2 confines to the design system — strictly enough that a data module
 * importing one cannot be reached by a test at all. Keeping the map here leaves the capability
 * modules DOM-free, so what a capability applies to and what it contributes to the Overview stay
 * checkable without rendering anything.
 *
 * A capability with no entry here gets the standard not-yet-served treatment. Giving one a real
 * surface is a component and a line in this map, and clearing its `awaiting` in its own module.
 */
import type { Component } from "svelte";
import type { CapabilityPanelProps } from "./capability.ts";
import { FILE_TYPE_CAPABILITY } from "./workbench-file.ts";
import { HASH_CAPABILITY } from "./capabilities/hash.ts";
import { OVERVIEW_CAPABILITY } from "./overview.ts";
import OverviewPanel from "./panels/overview-panel.svelte";
import FileTypePanel from "./panels/file-type-panel.svelte";
import HashPanel from "./panels/hash-panel.svelte";
import ConvertPanel from "./panels/convert-panel.svelte";
import UnlockPanel from "./panels/unlock-panel.svelte";
import EmailPanel from "./panels/email-panel.svelte";

const PANELS: Readonly<Record<string, Component<CapabilityPanelProps>>> = {
  [OVERVIEW_CAPABILITY]: OverviewPanel,
  [FILE_TYPE_CAPABILITY]: FileTypePanel,
  [HASH_CAPABILITY]: HashPanel,
  convert: ConvertPanel,
  unlock: UnlockPanel,
  email: EmailPanel,
};

/** The panel for a capability, or null where it has none yet. */
export function panelFor(capabilityId: string): Component<CapabilityPanelProps> | null {
  return PANELS[capabilityId] ?? null;
}
