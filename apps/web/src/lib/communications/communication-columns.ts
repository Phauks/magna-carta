/*
 * The log's declarative column model — what the platform's one table is told about the calls and
 * texts a firm has made and taken. Pure: it takes what the surface knows and returns columns, so
 * what a column IS has one home and one test, and the screens own only fetching and rendering.
 *
 * Four decisions worth stating, because each is about not inventing:
 *
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
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { Communication } from "./communications-api.ts";
import {
  anchorText,
  channelEntry,
  counterpartyNumberText,
  directionEntry,
  durationText,
  saidText,
} from "./communication-vocabulary.ts";

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
      value: (communication) => anchorText(communication),
    });
  }

  columns.push(
    {
      id: "said",
      // The DESCRIPTION, for a call and a text alike: what a member wrote down about the call, or
      // the words of the message. One word for one column.
      label: "Description",
      value: (communication) => saidText(communication),
    },
    {
      id: "duration",
      label: "Length",
      // Blank on a message, which has no length in seconds. Not a gap: a text does not have one.
      value: (communication) => durationText(communication.durationSeconds) ?? "",
    },
  );

  return columns;
}

/** How the log opens: most recent first, which is how a log is read. */
export const COMMUNICATION_INITIAL_SORT = {
  columnId: "occurredAt",
  direction: "descending",
} as const;
