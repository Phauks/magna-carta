/*
 * One call or text, on paper.
 *
 * A record of a phone call is read back long after everyone has forgotten it — in a fee dispute, by
 * a successor lawyer picking the file up, by a client asking what the firm did about their message.
 * So the sheet states BOTH instants and never lets them blur: when the call happened, and when
 * somebody wrote it down. A record that says only one of those cannot answer how long after the call
 * it was written, which is the first question anybody asks of a recollection.
 *
 * IT ALSO STATES WHERE THE ROW CAME FROM. A member's account of a call and a carrier's report of the
 * same call carry different weight, and a reader holding a printed page has no chip to hover.
 *
 * The sheet is data, never markup: what reaches the paper is the closed set of strings below.
 */
import type { PrintSheetDocument } from "@magna-carta/design-system/print-sheet/projection";
import type { Communication } from "./communications-api.ts";
import {
  anchorText,
  attachmentNote,
  channelEntry,
  counterpartyNumberText,
  directionEntry,
  durationText,
} from "./communication-vocabulary.ts";

/** Everything the sheet needs that is not the record itself. */
export interface CommunicationSheetContext {
  /** The Directory record at the other end, where one is named. Never a handle. */
  readonly counterpartyName: string | null;
  /** Who was on the firm's side, as a name. */
  readonly memberName: string | null;
  /** Who typed the record in, where anybody did. */
  readonly loggedByName: string | null;
  /** A stored instant as a reader sees it. */
  readonly instant: (at: string) => string;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

export function communicationSheet(
  communication: Communication,
  context: CommunicationSheetContext,
): PrintSheetDocument {
  const carried = attachmentNote(communication.channel);
  const length = durationText(communication.durationSeconds);
  const description = communication.body ?? communication.summary ?? "";
  return {
    heading: channelEntry(communication.channel).label === "Call" ? "Call Record" : "Text Record",
    subtitle: anchorText(communication),
    sections: [
      {
        id: "what",
        kind: "fields",
        fields: [
          // WHEN IT HAPPENED comes first: a reader reaching for this record is reaching for the
          // moment of the call, not for when somebody got round to typing it.
          { label: "When", value: context.instant(communication.occurredAt) },
          { label: "Type", value: channelEntry(communication.channel).label },
          { label: "Direction", value: directionEntry(communication.direction).label },
          {
            label: "Number",
            value: counterpartyNumberText(communication.counterpartyNumber),
            ...(context.counterpartyName === null ? {} : { secondary: context.counterpartyName }),
          },
          ...(length === null ? [] : [{ label: "Duration", value: length }]),
          ...(carried === null ? [] : [{ label: "Carried", value: carried }]),
        ],
      },
      {
        id: "record",
        kind: "text",
        title: "Description",
        text: description === "" ? "Nothing was written down." : description,
      },
      {
        id: "provenance",
        kind: "fields",
        title: "How this record was made",
        fields: [
          {
            label: "Source",
            value:
              communication.producer === "carrier"
                ? "Reported by the carrier"
                : "Written down by a member",
          },
          ...(context.memberName === null
            ? []
            : [{ label: "Firm's side", value: context.memberName }]),
          ...(context.loggedByName === null
            ? []
            : [{ label: "Recorded by", value: context.loggedByName }]),
          { label: "Recorded", value: context.instant(communication.createdAt) },
        ],
      },
    ],
    footer: `Magna Carta · printed ${context.printedAt}`,
  };
}
