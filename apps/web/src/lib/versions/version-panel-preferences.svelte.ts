/*
 * What the Build Information panel remembers between openings: which of its sections are folded
 * away.
 *
 * There are FOUR and they sit SIDE BY SIDE — Deployment, Features, Database, Upload readiness.
 * The fleet and the outside services no longer fold on their own: System Status shows each beside
 * the features it powers, in one table. Each fold remembers itself, because folding one away is
 * not a statement about the others.
 *
 * THE FOLDS ARE A REGISTRY, not four exported constants. They were four, and the fourth arrived
 * without the doc comment the other three carry and without the header sentence above being
 * updated — which is what a hand-maintained list of near-identical things does. A section now joins
 * by adding one entry to PANEL_SECTION_FOLDS, and its storage key is derived from its id rather
 * than spelled out a second time.
 *
 * These are per-browser chrome state, not firm data, so they ride the shared persisted-preference
 * primitive ($lib/preferences/persisted-preference.svelte.ts): storage hazards are swallowed there,
 * a read that cannot be trusted falls back to the default, and the cross-tab follower keeps two
 * open tabs from disagreeing about a fold the same person just performed.
 *
 * EXPANDED IS THE DEFAULT, deliberately, for all of them. The panel exists to show what is there,
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

/**
 * The storage key for a section's fold. Derived from the section id so the key and the section
 * cannot drift; the ids below are therefore part of the stored state and must not be renamed — a
 * new id silently discards a fold a reader already set.
 */
function foldStorageKey(sectionId: string): string {
  return `magna-carta.version-panel-${sectionId}`;
}

function createSectionFold(sectionId: string): SectionFoldPreference {
  const preference = createPersistedPreference(
    stringUnionPreference<SectionState>(
      foldStorageKey(sectionId),
      ["expanded", "collapsed"],
      "expanded",
    ),
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

/**
 * Every folding section of the panel, by id.
 *
 * ADD A SECTION HERE and it has a remembered fold with no further edit. The ids are stored state
 * (see foldStorageKey): renaming one would silently undo a fold a reader already set.
 */
export const PANEL_SECTION_FOLDS = {
  /** The API and the Worker serving this page, and how the two compare. */
  deployment: createSectionFold("deployment"),
  /** The features the deployment can switch on, and which are working. */
  features: createSectionFold("features"),
  /** The connection to this firm's own data. */
  database: createSectionFold("database"),
  /** Whether a file chosen in this browser can reach the firm's storage. */
  readiness: createSectionFold("readiness"),
} as const satisfies Record<string, SectionFoldPreference>;
