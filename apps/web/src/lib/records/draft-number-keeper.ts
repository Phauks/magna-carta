/*
 * The app's side of a draft number: how a create panel holds the number its record will be saved
 * under, and gives it back when it is cancelled. The lifecycle (asking again on a scope change,
 * renewing while open, handing back a superseded answer) is the design system's `DraftNumber`; this
 * is only the transport it is handed, over `numbering.holdDraftNumber` and
 * `numbering.releaseDraftNumber` through the generated client.
 *
 * One keeper for every kind of record. What differs between them is which run the number comes
 * from and what the panel knows so far that the firm's scheme may render — the date a call
 * happened, a matter's client — and the panel passes those as a reader, so a renewal sends what the
 * panel holds at that moment rather than what it held when it opened.
 */
import {
  numberingHoldDraftNumber,
  numberingReleaseDraftNumber,
  type NumberReservationRequest,
} from "@magna-carta/api-client";
import type { DraftNumberKeeper } from "@magna-carta/design-system/record-reference";

/** Which run a panel's record is numbered from: every run a panel holds a draft number on. */
export type DraftNumberPurpose = NumberReservationRequest["purpose"];

/** What else the panel knows that the firm's scheme may render. */
export type DraftNumberHints = Pick<NumberReservationRequest, "occurredAt" | "context">;

/**
 * A keeper for one panel. Never throws: a refused or unreachable hold answers null, and the panel
 * still saves its record, which is then numbered by the save.
 */
export function draftNumberKeeper(
  purpose: DraftNumberPurpose,
  hints: () => DraftNumberHints = () => ({}),
): DraftNumberKeeper {
  return {
    async hold(token) {
      try {
        const { data } = await numberingHoldDraftNumber({
          body: { purpose, ...hints(), ...(token === null ? {} : { token }) },
          throwOnError: true,
        });
        return data.token === null || data.number === null
          ? null
          : { token: data.token, number: data.number };
      } catch {
        return null;
      }
    },
    async release(token) {
      try {
        await numberingReleaseDraftNumber({ path: { token }, throwOnError: true });
      } catch {
        // A number not given back lapses on the server and the next record takes it.
      }
    },
  };
}
