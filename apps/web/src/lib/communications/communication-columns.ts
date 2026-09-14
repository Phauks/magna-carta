/*
 * The log's declarative column model — what the platform's one table is told about the calls and
 * texts a firm has made and taken. Pure: it takes what the surface knows and returns columns, so
 * what a column IS has one home and one test, and the screens own only fetching and rendering.
 *
 * Five decisions worth stating, because each is about not inventing:
 *
 *   - THE NUMBER LEADS. Every call and text carries one — the day it happened and that day's own
 *     sequence — and it is what a firm quotes out loud, so it is the first thing on the row and the
 *     first thing the search matches. A row recorded before the sequence existed says so rather
 *     than rendering blank, because a blank there reads as a column that failed to fill.
 *   - WHEN anchors the row and leads it. A log is read in time order, and every question anybody
 *     brings to it — did we call them back, when did they last text — is a question about when.
 *   - WHO is the number, and it stays the number even where the Directory resolved it. A person
 *     looking for a text remembers the number they dialled more reliably than the name the firm
 *     filed them under, and the resolved name is offered beside it rather than instead of it.
 *   - MATTER carries the anchor's STATUS, not just its name. An intake and a consultation are real
 *     anchors and they carry no matter number, so the cell falls through to what the row actually
 *     has; a row set aside as spam or firm business names the reason it is on no matter; and a row
 *     nobody has decided about yet says it is not filed rather than rendering blank, because a blank
 *     there reads as a record the platform failed to fill.
 *   - SAID is one line of what was said, and a call with nothing written says so. A missed call is a
 *     real record — the phone rang and nobody answered — and an empty cell would read as a gap.
 */
import type { GridColumn, GridColumnFilter } from "@magna-carta/design-system/data-table";
import type { Communication, CommunicationScope } from "./communications-api.ts";
import {
  anchorText,
  channelEntry,
  counterpartyNumberText,
  directionEntry,
  DISPOSITION_CHOICES,
  durationText,
  NOT_FILED_TEXT,
  NOT_NUMBERED_TEXT,
} from "./communication-vocabulary.ts";

/**
 * What the Matter column always offers, whatever is loaded: the queue's own word and the three
 * reasons a row is on no matter. The matters themselves follow from the rows in hand. A firm with
 * nothing waiting today still has a queue, and a filter that dropped "Not filed" because none was
 * on screen would be telling the reader the firm cannot have one.
 */
export const MATTER_FILTER_VOCABULARY: readonly string[] = [
  NOT_FILED_TEXT,
  ...DISPOSITION_CHOICES.map((choice) => choice.label),
];

const SET_ASIDE_LABELS = new Set(DISPOSITION_CHOICES.map((choice) => choice.label));

/**
 * The listing's scope a Matter filter's selection stays inside, or undefined where it crosses two.
 *
 * The four scope tabs the screen used to carry asked exactly what this column's filter asks — the
 * queue, what is filed, what was set aside — so the filter is the control and this is how it
 * reaches the server: "Not filed" alone is the queue, the set-aside reasons alone are what was set
 * aside, and any selection of matters alone is what is filed. A selection crossing those lines is
 * a question the listing cannot take, so the server is asked for everything and the table narrows
 * the loaded rows.
 */
export function scopeForMatterSelection(
  filter: GridColumnFilter | undefined,
): Exclude<CommunicationScope, "all"> | undefined {
  if (filter?.kind !== "set" || filter.values.length === 0) return undefined;
  const scopes = new Set(
    filter.values.map((value): Exclude<CommunicationScope, "all"> => {
      if (value === NOT_FILED_TEXT) return "unrouted";
      return SET_ASIDE_LABELS.has(value) ? "setAside" : "routed";
    }),
  );
  if (scopes.size !== 1) return undefined;
  const [only] = scopes;
  return only;
}

/** What a counterparty handle resolves to, by handle. Empty until the Directory read lands. */
export interface CommunicationVocabulary {
  counterpartyNames: ReadonlyMap<string, string>;
}

/** An empty vocabulary — what a screen holds before any name has been resolved. */
export const EMPTY_COMMUNICATION_VOCABULARY: CommunicationVocabulary = {
  counterpartyNames: new Map(),
};

/** Build the lookup the column model needs from whatever names a surface resolved. */
export function communicationVocabulary(
  entities: readonly { id: string; name: string }[],
): CommunicationVocabulary {
  return { counterpartyNames: new Map(entities.map((entity) => [entity.id, entity.name])) };
}

/**
 * The counterparty as it prints: the name where the Directory resolved one, the number otherwise.
 *
 * A handle the Directory does not name renders as the NUMBER rather than as the handle. That is the
 * custody register's rule and it is stronger here: the number is a real answer a person can use,
 * where `directoryPerson_01J…` is not an answer at all.
 */
export function counterpartyText(
  communication: Communication,
  vocabulary: CommunicationVocabulary,
): string {
  const number = counterpartyNumberText(communication.counterpartyNumber);
  if (communication.counterpartyEntityId === null) return number;
  return vocabulary.counterpartyNames.get(communication.counterpartyEntityId) ?? number;
}

/**
 * The log's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize are the
 * grid's; this only declares what each column is.
 *
 * Channel, Direction and Matter take the SET filter — a checkbox list with counts — because each is
 * a small closed vocabulary in practice: a person narrows by picking "Call", not by typing it. Who
 * and Said take the default contains-text filter, and When the date range.
 */
export function communicationColumns(
  vocabulary: CommunicationVocabulary,
  options: { readonly showMatter: boolean },
): GridColumn<Communication>[] {
  const columns: GridColumn<Communication>[] = [
    {
      id: "referenceNumber",
      label: "Number",
      // Not filtered as a set: every value is distinct, so a checkbox list of them would be the
      // table again. The screen's own search is what finds one, and it matches this first.
      value: (communication) => communication.referenceNumber ?? NOT_NUMBERED_TEXT,
    },
    {
      id: "occurredAt",
      label: "When",
      type: "date",
      anchored: true,
      // When it HAPPENED, never when it was typed. A call logged on Thursday about Tuesday belongs
      // beside Tuesday, which is how every other record of something that happened is ordered here.
      value: (communication) => communication.occurredAt,
    },
    {
      id: "channel",
      // TYPE, not "kind". The form asks for the same word, so the column a person filters by and the
      // field they filled carry one name (owner ruling, 2026-09-08).
      label: "Type",
      filter: "set",
      // The word, not the enum: the set filter offers what the column shows, and a person filters on
      // "Call", never on `voice`.
      value: (communication) => channelEntry(communication.channel).label,
    },
    {
      id: "direction",
      label: "Direction",
      filter: "set",
      value: (communication) => directionEntry(communication.direction).label,
    },
    {
      id: "counterparty",
      label: "Who",
      value: (communication) => counterpartyText(communication, vocabulary),
    },
  ];

  // The matter column is absent inside a matter, where every row is on the same one and a column of
  // one repeated value is a column that costs width and says nothing.
  if (options.showMatter) {
    columns.push({
      id: "matter",
      label: "Matter",
      filter: "set",
      filterValues: MATTER_FILTER_VOCABULARY,
      value: (communication) => anchorText(communication),
    });
  }

  // THE DESCRIPTION IS NOT A COLUMN (owner ruling, 2026-09-08: "the description should be in a line
  // beneath the other information, consider how we do that for time entries"). It is prose, and
  // usually far longer than every other fact on the row put together — as a column it was either
  // truncated to a few words, which is not a description, or wide enough to push the facts off the
  // screen. It is the row's SECOND LINE instead, with the row's whole width to wrap in, through the
  // one table's own row-detail (communication-log.svelte), which is the same mechanism the time
  // sheet's description sits in.
  columns.push({
    id: "duration",
    label: "Duration",
    // Blank on a message, which has no length in seconds. Not a gap: a text does not have one.
    value: (communication) => durationText(communication.durationSeconds) ?? "",
  });

  return columns;
}

/** How the log opens: most recent first, which is how a log is read. */
export const COMMUNICATION_INITIAL_SORT = {
  columnId: "occurredAt",
  direction: "descending",
} as const;
