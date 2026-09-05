/*
 * What the version panel remembers between openings: which of its sections are folded away.
 *
 * There are three, and they nest — Deployment and Database are the panel's two subjects, and the
 * fleet list sits inside Deployment. Each remembers itself separately, because folding the fleet
 * away is a different intent from folding the whole deployment away, and a reader who did one
 * should not find the other undone next time.
 *
 * These are per-browser chrome state, not firm data, so they ride the shared persisted-preference
 * primitive ($lib/preferences/persisted-preference.svelte.ts): storage hazards are swallowed there,
 * a read that cannot be trusted falls back to the default, and the cross-tab follower keeps two
 * open tabs from disagreeing about a fold the same person just performed.
 *
 * EXPANDED IS THE DEFAULT, deliberately, for all three. The panel exists to show what is there,
 * faults included; a section that arrived folded would hide an unreachable Worker, or a membership
 * that never landed, from someone who opened the panel to find exactly that. Folding is a choice
 * this remembers, never the state it starts in.
 */
import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";

type SectionState = "expanded" | "collapsed";

/** One remembered fold: whether it is shut, and the one gesture that changes it. */
export interface SectionFoldPreference {
  readonly collapsed: boolean;
  toggle(): void;
}

function createSectionFold(storageKey: string): SectionFoldPreference {
  const preference = createPersistedPreference(
    stringUnionPreference<SectionState>(storageKey, ["expanded", "collapsed"], "expanded"),
  );
  preference.followAcrossTabs();
  return {
    get collapsed(): boolean {
      return preference.current === "collapsed";
    },
    toggle(): void {
      preference.set(preference.current === "collapsed" ? "expanded" : "collapsed");
    },
  };
}

/** The whole deployment section — the API, the Worker serving this page, and the fleet within it. */
export const deploymentSectionPreference = createSectionFold(
  "magna-carta.version-panel-deployment",
);

/** The fleet list inside the deployment section. */
export const fleetSectionPreference = createSectionFold("magna-carta.version-panel-fleet");

/** The database-health section: the connection to this firm's own data. */
export const databaseSectionPreference = createSectionFold("magna-carta.version-panel-database");
