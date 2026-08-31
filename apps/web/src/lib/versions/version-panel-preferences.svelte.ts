/*
 * What the version panel remembers between openings. Today that is one thing: whether the fleet
 * section — every sibling Worker beneath the pair that serves the app's address — is folded away.
 *
 * It is per-browser chrome state, not firm data, so it rides the shared persisted-preference
 * primitive ($lib/preferences/persisted-preference.svelte.ts): storage hazards are swallowed there,
 * a read that cannot be trusted falls back to the default, and the cross-tab follower keeps two
 * open tabs from disagreeing about a fold the same person just performed.
 *
 * EXPANDED IS THE DEFAULT, deliberately. The list exists to show the whole fleet, silent Workers
 * included; a panel that arrives folded would hide an unreachable Worker from someone who opened
 * the panel to find one. Folding is a choice this remembers, never the state it starts in.
 */
import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";

const STORAGE_KEY = "magna-carta.version-panel-fleet";

type FleetSectionState = "expanded" | "collapsed";

const preference = createPersistedPreference(
  stringUnionPreference<FleetSectionState>(STORAGE_KEY, ["expanded", "collapsed"], "expanded"),
);
preference.followAcrossTabs();

/** Whether the fleet section is folded away, and the one gesture that changes it. */
export const fleetSectionPreference = {
  get collapsed(): boolean {
    return preference.current === "collapsed";
  },
  toggle(): void {
    preference.set(preference.current === "collapsed" ? "expanded" : "collapsed");
  },
};
