/*
 * How the matter's own standing reads on its Activity section: one source, one sentence per
 * lifecycle event. The audit log is the substrate and nothing here reads past those events.
 */
import Flag from "@lucide/svelte/icons/flag";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

const HAPPENED: Readonly<Record<string, string>> = {
  "matter.created": "The matter was created",
  "matter.graduated": "The intake was completed and the matter became a consultation",
  "matter.opened": "The matter was opened",
  "matter.held": "The matter was put on hold",
  "matter.released": "The hold was released and the matter is active again",
  "matter.closed": "The matter was closed",
  "matter.reopened": "The matter was reopened",
};

export const matterLifecycleActivityContribution: ActivityContribution = {
  sourceKey: "matterLifecycle",
  section: "Matter",
  noun: "Matter",
  happened: (kind) => HAPPENED[kind] ?? "The matter changed standing",
  icon: Flag,
  types: ["Matter"],
  open: navigateInto,
};
