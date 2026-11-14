/*
 * THE CATALOGUE VOCABULARY — the one shape behind every screen that lists things a member opens.
 *
 * Tools and Reports were the same screen written twice: sections with an engraved heading, and
 * under each a run of entries carrying a glyph, a name, one line saying what the thing does, and a
 * maturity mark that decides whether the entry is a link or an honest "not yet". Two copies is two
 * places a correction has to land and two ways the same screen can drift, which is the defect this
 * module exists to end — the same argument the screen header and ScreenSearch already settled for
 * their own parts of a page.
 *
 * WHAT BELONGS HERE is the shape a catalogue takes, and nothing about what is IN one. A tool's
 * subject group, a report's family, the permission a read enforces, what a report waits on — every
 * one of those stays in its own registry, which projects into this vocabulary at the edge. That
 * division is what keeps the shared layer from growing a branch per consumer: this module cannot
 * name a tool or a report, so it cannot special-case one.
 *
 * TWO FACTS DECIDE HOW AN ENTRY RENDERS, and both are the caller's:
 *   - `href` — where the entry goes. `null` means there is nowhere to go yet, and the entry renders
 *     as a plain, unlinked row or tile rather than a disabled-looking control. A registry decides
 *     this from its own maturity stage; the catalogue does not read the stage to guess it.
 *   - `waitsOn` — the noun phrase completing "Not built yet: …", where the registry knows
 *     the dependency. Absent where it does not; the entry then says only what its badge says.
 */
import type { Component } from "svelte";
// Type-only: elided at build, so the plugin-less web test config never resolves the package alias.
import type { MaturityStage } from "@magna-carta/design-system/maturity";

/** One thing a member can open, as the catalogue renders it. */
export interface CatalogueEntry {
  /** Stable within its catalogue: the keyed identity of the row and the tile. */
  readonly id: string;
  /** What the thing is called, in the words its own registry uses. */
  readonly name: string;
  /** One line, plain language: what the tool does, or the question the report answers. */
  readonly description: string;
  /** How finished the surface is. Only `soon` wears a mark; the rest are silent. */
  readonly stage: MaturityStage;
  /** The entry's glyph, resolved by the registry from whatever it stores. */
  readonly icon: Component;
  /** Where the entry opens, or `null` when there is nothing behind it yet. */
  readonly href: string | null;
  /** The dependency a not-yet-built entry is waiting on, as a noun phrase. */
  readonly waitsOn?: string;
  /**
   * Words a reader might search by that are not already in the name or the description — a former
   * name, the vocabulary of a neighbouring product. Searched, never shown.
   */
  readonly keywords?: readonly string[];
}

/** A run of entries under one engraved heading — a tool's subject group, a report's family. */
export interface CatalogueSection {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly CatalogueEntry[];
}

/** How many entries a catalogue holds across all of its sections. */
export function countCatalogueEntries(sections: readonly CatalogueSection[]): number {
  return sections.reduce((running, section) => running + section.entries.length, 0);
}
