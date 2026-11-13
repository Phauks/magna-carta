/*
 * THE DIAGNOSTIC-ACTION REGISTRY — the one home for developer and support tools that OPEN
 * something rather than navigating somewhere.
 *
 * The command palette renders registries and never hand-lists an item
 * ($lib/components/command-palette.svelte states the contract): app pages come from the destination
 * registry, settings from the settings-section registry, tools from the tool catalog. Every one of
 * those registries describes a DESTINATION — an id and an href, and selecting it is a `goto`.
 *
 * The Build Information panel fits none of them. It is a popover anchored to a chip in the header:
 * there is no route to navigate to, and the thing that happens when you pick it is a function call.
 * Hard-coding it into the palette was the obvious move and the wrong one — a hardcoded item is
 * invisible to the registry's owners and silently rots, which is exactly why the palette forbids it.
 *
 * So this is the registry for that shape, and it is deliberately general: an id, what to call it,
 * the words it should be findable by, whether it is available in this build at all, and the function
 * that runs. The next developer surface that opens in place rather than at an address — a log
 * viewer, a feature-flag inspector, a seeded-state switcher — joins by adding an entry here and is
 * searchable in the same commit, with no edit to the palette.
 *
 * AVAILABILITY IS PART OF THE ENTRY, not a filter the palette applies. Some of these will be
 * development-only and some will be gated on a permission; an entry that knows its own rule can be
 * added by whoever owns the tool without teaching the palette anything about it.
 *
 * Kept free of Svelte so the node-pool fitness test can walk the registry directly. The RUNNING of
 * an action is a closure the registry holds, which is how a pure module ends up able to open a
 * popover somebody else owns: the state it flips lives in that surface's own module
 * ($lib/versions/build-panel.svelte.ts).
 */
import { buildPanel } from "$lib/versions/build-panel.svelte.ts";

/** One thing a reader can make happen from search that is not a navigation. */
export interface DiagnosticAction {
  /** Stable id, kebab-case. Used as the palette's key; never shown. */
  readonly id: string;
  /** What it is called, in the vocabulary the surface itself uses. */
  readonly label: string;
  /** Extra words it should be findable by — lay synonyms, the fault somebody is chasing. */
  readonly keywords: readonly string[];
  /**
   * Whether this build offers it at all. Evaluated when the palette renders, so an entry may read a
   * permission or a build mode; an unavailable entry is omitted rather than shown disabled, because
   * unlike a "— soon" destination there is nothing coming that a reader should know about.
   */
  available(): boolean;
  /** What picking it does. The palette closes itself first, then calls this. */
  run(): void;
}

export const DIAGNOSTIC_ACTIONS: readonly DiagnosticAction[] = [
  {
    id: "build-information",
    label: "Build Information",
    // The words somebody uses when they are chasing this panel without knowing its name: they want
    // the version, or they have been asked which commit they are on, or something is down and they
    // are looking for the thing that says whether the deployment is healthy.
    keywords: [
      "version",
      "versions",
      "commit",
      "build",
      "deployment",
      "workers",
      "fleet",
      "diagnostics",
      "health",
      "database",
      "upload readiness",
      "what is running",
      "system status",
      "features",
      "errors",
      "feature flags",
    ],
    // Always: the panel is on every screen, signed in or out. The Versions settings page renders the
    // same report at page size and is already searchable through the settings-section registry, so
    // this entry is the panel specifically — the answer without leaving the screen you are on.
    available: () => true,
    run: () => {
      buildPanel.open();
    },
  },
];

/** The actions this build actually offers, in registry order. */
export function availableDiagnosticActions(): DiagnosticAction[] {
  return DIAGNOSTIC_ACTIONS.filter((action) => action.available());
}
