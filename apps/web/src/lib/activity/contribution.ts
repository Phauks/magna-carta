/*
 * What a subsystem tells the matter's Activity section about its own rows.
 *
 * A CONSOLIDATION VIEW CANNOT KNOW WHAT ITS ROWS ARE. Only the file manager knows what a file is;
 * only the calendar knows what a hearing is called; only the ledger knows what a time entry is worth.
 * The moment the Activity section decides those things in its own files it is a second file
 * manager, a second calendar and a second ledger, each a little wrong — which is exactly what its
 * first cut was. So the words, the glyph, the facts, the way a row opens and the way one is made are
 * all declared HERE, by the subsystem, in a contribution that lives beside that subsystem's own web
 * code and is registered once in contributions.ts. The Activity section names no source and
 * switches on none.
 *
 * THE SERVER HALF IS THE SOURCE'S OWN `describe`. packages/calendar/src/sources/all.ts declares
 * where a source's rows live and, where they have names, one statement that names a page of them
 * for one matter behind the source's own read capability. What that statement projects — a title,
 * the subsystem's own word for what the row is, and a `facts` object in that subsystem's own
 * vocabulary — is what a contribution reads. Nothing in between interprets the facts: the timeline
 * carries them opaque, and only the contribution that owns the source key knows what they mean.
 *
 * DOM-FREE, DELIBERATELY. This module and every contribution are plain data and pure functions, so
 * the fitness test that pairs them to the server's registry runs without a browser. Anything that
 * needs a formatter from the design system takes it through `FactContext`, which the screen
 * supplies — the formatters pull Svelte components into a node test otherwise.
 */
import type { Component } from "svelte";
import type { ActivityWindowKey } from "./window-keys.ts";
import type { ActivityEntry } from "$lib/matters/activity-api.ts";
import { hasSurface } from "@magna-carta/design-system/maturity";
import {
  UNSECTIONED_TIMELINE_SOURCES,
  sectionOwningTimelineSource,
} from "$lib/matters/sections.ts";

/**
 * The Section column's word: which part of the matter a row belongs to. Each contribution declares
 * its own, and the column's vocabulary is the set of them (contributions.ts) — declared by the
 * registry rather than read off the rows, so a matter with no costs yet still offers "Costs" and
 * does not tell a reader it can never have one. The fitness test holds the word to the owning
 * section's own label, so no contribution can invent a section the strip does not have.
 */
export type ActivitySection = string;

/** What the owning source said about a row, where it said anything. */
export interface DescribedRow {
  /** What the reader recognises the row by. */
  readonly title: string;
  /** The subsystem's own word for what the row is, or null where the contribution's noun is right. */
  readonly typeText: string | null;
  /** The subsystem's own fields. Only the contribution that owns the source key reads these. */
  readonly facts: Readonly<Record<string, unknown>> | null;
}

/** One fact beside a row's name: a size, an amount, a state. Label-less where the value speaks. */
export interface Fact {
  readonly label?: string;
  readonly value: string;
  /** Danger for a state that changes what somebody does about it — quarantined, overdue. */
  readonly tone?: "muted" | "danger" | "info";
}

/**
 * What the Type cell draws beside its word. A file's glyph is the file manager's own (the
 * design-system FileIcon over the content type and name), which is why this is data rather than a
 * component: the screen draws it, and the contribution only says what it is.
 */
export type Glyph =
  | { readonly kind: "icon"; readonly icon: Component }
  | { readonly kind: "file"; readonly fileName: string; readonly contentType: string | null };

/**
 * How a row opens. A window opens on this screen; a navigation carries the timeline's own deep link
 * (`/matters/{id}/{section}?entry={rowId}`) into the owning section; none states why there is
 * nowhere to go, which is honest, rather than a link into a stub that cannot honour it.
 */
export type OpenTarget =
  | { readonly kind: "window"; readonly window: ActivityWindow; readonly recordId: string }
  | { readonly kind: "navigate"; readonly href: string }
  | { readonly kind: "none"; readonly reason: string };

/**
 * A record window the Activity register can host, by key. The keys live in window-keys.ts and the
 * components behind them in windows.ts, beside the contributions — the register mounts whichever
 * one a contribution names and never names one itself. A subsystem with a window adds one key and
 * one entry there.
 */
export type ActivityWindow = ActivityWindowKey;

/**
 * What every hosted window takes: the register knows this and nothing else about it. A host reads
 * its own record by id and gathers whatever else its window needs — the register hands it a matter
 * and a record, and hears back when something landed.
 */
export interface ActivityWindowProps {
  open: boolean;
  /** The record to open, or null to make a new one. */
  recordId: string | null;
  matterId: string;
  matterTitle: string;
  onSaved: (savedRecordId: string) => void;
  onDeleted?: () => void;
  /** The record landed but these attachments did not; the register says so where it can. */
  onAttachmentsUnwritten?: (names: readonly string[]) => void;
}

/** How one of this subsystem's records is made from the Activity section: the verb and its window. */
export interface CreateVerb {
  readonly label: string;
  readonly window: ActivityWindow;
}

/** The formatters a contribution may need and must not import: the screen supplies them. */
export interface FactContext {
  readonly money: (amountMinor: number, currency: string) => string;
  readonly date: (civilDate: string) => string;
  /** Today as a civil date where the reader is, for the comparisons a stored fact must not make. */
  readonly today: string;
}

export interface ActivityContribution {
  /** The wire source key, exactly as packages/calendar declares it. Permanent once shipped. */
  readonly sourceKey: string;
  /** Which part of the matter these rows belong to — the Section column's word. */
  readonly section: ActivitySection;
  /** What kind of thing this is, singular, where nothing more exact is known: "Document". */
  readonly noun: string;
  /**
   * What happened, as a whole sentence in the platform's own voice, for a row the source did not
   * describe. Per kind where one source records several things: the matter's own lifecycle.
   */
  readonly happened: string | ((kind: string) => string);
  readonly icon: Component;
  /** What the source's declared label IS, where it declares one — "Document type", "Time booked". */
  readonly labelMeaning?: string;
  /**
   * The Type words this source can put on the table, so the filter offers them unseen. Empty where
   * the vocabulary is the firm's own (document types) and the filter learns it from the rows.
   */
  readonly types: readonly string[];
  /** The Type column's word for a described row. Defaults to the row's own typeText, then the noun. */
  readonly typeOf?: (row: DescribedRow) => string;
  /** What the Type cell draws beside its word. Defaults to the contribution's icon. */
  readonly glyphOf?: (row: DescribedRow) => Glyph;
  /** The facts beside the name, typed so a cell can render label and value. */
  readonly factsOf?: (row: DescribedRow, context: FactContext) => readonly Fact[];
  /** How a row opens. */
  readonly open: (entry: ActivityEntry) => OpenTarget;
  /** How to make one from here. Absent where the subsystem has no window the section can host yet. */
  readonly create?: CreateVerb;
}

/** The description the server attached to an entry, or null where it attached none. */
export function describedRowOf(entry: ActivityEntry): DescribedRow | null {
  if (entry.title === null) return null;
  return { title: entry.title, typeText: entry.typeText, facts: entry.facts };
}

/**
 * The open target every contribution without a window of its own uses: follow the timeline's deep
 * link into the section that owns the source, or say why there is nowhere to go.
 *
 * The question is asked of the section registry rather than answered by a list here, so a section
 * coming alive lights its rows up on its own and the coverage lint keeps the two in step.
 */
export function navigateInto(entry: ActivityEntry): OpenTarget {
  const section = sectionOwningTimelineSource(entry.sourceKey);
  if (section === undefined) {
    return {
      kind: "none",
      reason: UNSECTIONED_TIMELINE_SOURCES[entry.sourceKey] ?? "Not in any section",
    };
  }
  if (!hasSurface(section.stage)) {
    return { kind: "none", reason: `The ${section.label} section is not built yet` };
  }
  return { kind: "navigate", href: entry.link };
}

/** A fact's field as a string, or null where the source recorded none or the shape is unexpected. */
export function factText(
  facts: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = facts?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A fact's field as a number, or null. SQLite hands booleans over as 0 and 1, which land here. */
export function factNumber(
  facts: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const value = facts?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A capitalised single word from a closed vocabulary the server sent lower-case: "open" → "Open". */
export function capitalised(word: string): string {
  return word.length === 0
    ? word
    : word.charAt(0).toUpperCase() + word.slice(1).replace(/_/gu, " ");
}
