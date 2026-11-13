/*
 * How each matter-search source LOOKS. The server's registry decides which sources exist, which
 * ones a reader may use and in what order they answer; this decides the icon and the heading each
 * one wears, and how a hit's title should be read.
 *
 * THIS IS THE ONLY FILE ON THE CLIENT A NEW SOURCE TOUCHES. The control, the panel, the scope
 * dropdown, the results page and the transport are all generic over whatever the server sends — a
 * source with no entry here still renders, under its own key and a neutral icon, rather than
 * vanishing from a surface that is supposed to be honest about what it searched.
 */
import type { Component } from "svelte";
import FileText from "@lucide/svelte/icons/file-text";
import FileSearch from "@lucide/svelte/icons/file-search";
import Users from "@lucide/svelte/icons/users";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Vault from "@lucide/svelte/icons/vault";
import Search from "@lucide/svelte/icons/search";
import Clock from "@lucide/svelte/icons/clock";
import ReceiptText from "@lucide/svelte/icons/receipt-text";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import FileSpreadsheet from "@lucide/svelte/icons/file-spreadsheet";
import Phone from "@lucide/svelte/icons/phone";
import type { SearchSkipReason } from "$lib/matters/matter-search-api.ts";

export interface SourcePresentation {
  /** The group heading, in the reader's vocabulary — matching the section tab's own label. */
  readonly heading: string;
  readonly icon: Component;
  /**
   * How to read a hit's title. "text" is a name to render as it stands; "instant" is a canonical
   * UTC instant the row should render as a date, because the record has no name of its own.
   */
  readonly titleKind: "text" | "instant";
}

const PRESENTATION: Readonly<Record<string, SourcePresentation>> = {
  files: { heading: "Files", icon: FileText, titleKind: "text" },
  // The same section, answered a second way: the names above, the words inside the documents here.
  // Two groups and two headings because they are two kinds of answer. A name match is a listing,
  // newest first; a match inside a document is ranked by how well the page answers the words.
  "file-contents": { heading: "Inside Files", icon: FileSearch, titleKind: "text" },
  parties: { heading: "Parties", icon: Users, titleKind: "text" },
  // A note has no name — the reader recognizes it by when it was written, and the snippet carries
  // the words. That is why titleKind exists at all rather than every source rendering a string.
  notes: { heading: "Notes", icon: NotebookPen, titleKind: "instant" },
  custody: { heading: "Custodian", icon: Vault, titleKind: "text" },
  // A call has no name either, and the same reasoning as a note applies twice over: what a reader
  // recognizes it by is when it happened, and the snippet carries what was said. The heading is the
  // SECTION's word rather than the source's — the source is named for the record it holds, the tab
  // for what a person calls it.
  communications: { heading: "Messaging", icon: Phone, titleKind: "instant" },
  // A time entry has no name either — what a reader recognizes it by is the day the work was done,
  // and the narrative is the excerpt beneath it.
  time: { heading: "Time", icon: Clock, titleKind: "instant" },
  costs: { heading: "Costs", icon: ReceiptText, titleKind: "text" },
  calendar: { heading: "Calendar", icon: CalendarDays, titleKind: "text" },
  billing: { heading: "Billing", icon: FileSpreadsheet, titleKind: "text" },
};

/** Never undefined: an unknown source renders under its own key rather than disappearing. */
export function presentationFor(sourceKey: string): SourcePresentation {
  return PRESENTATION[sourceKey] ?? { heading: sourceKey, icon: Search, titleKind: "text" };
}

/**
 * What a group with no hits should say, given why it has none. The source is named because one
 * source reads an index outside the firm's database, and "this section" would be wrong about it:
 * the Files section's names were searched even when the words inside its files could not be.
 */
export function emptyGroupLine(skipped: SearchSkipReason | null, sourceKey?: string): string {
  switch (skipped) {
    case "permission":
      // Never "no matches". A reader who cannot see a section must be told that is why, or they
      // learn the matter holds nothing when it may hold a great deal.
      return "You do not have access to this section";
    case "query-too-short":
      return "Type a little more to search here";
    case "engine-unavailable":
      return sourceKey === "file-contents"
        ? "The text inside files could not be searched just now. File and folder names were."
        : "This section could not be searched just now";
    case "engine-not-connected":
      // Not a fault, and trying again changes nothing: the part that reads inside documents is not
      // switched on yet. Said plainly, with what WAS searched, so it does not read as an error.
      return sourceKey === "file-contents"
        ? "Searching the text inside files is not switched on yet. File and folder names were searched."
        : "Searching this section is not switched on yet";
    case "not-indexed":
      // The firm's own choice, so it is said as one and not as a fault, with where it is made:
      // the Search and Indexing settings page is the one place that writes it.
      return "Searching inside files is turned off for this firm. An administrator can turn it on in Settings, under Search and Indexing.";
    case null:
      return "No matches";
  }
}

/** The one-word badge beside a group that could not answer. */
export function skippedBadge(skipped: SearchSkipReason): string {
  switch (skipped) {
    case "permission":
      return "No access";
    case "not-indexed":
      return "Off";
    case "engine-unavailable":
      return "Unavailable";
    case "engine-not-connected":
    case "query-too-short":
      return "Soon";
  }
}
