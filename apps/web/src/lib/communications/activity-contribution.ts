/*
 * How a call or a text reads on the matter's Activity section.
 *
 * The description names what was said — the member's own summary for a call, the message itself for
 * a text — and the facts beside it are what somebody scanning the chronology wants: which channel,
 * which way it went, and how long a call took.
 *
 * THE NUMBER IS NOT A FACT HERE, and its absence is deliberate. The server's own description
 * (packages/calendar/src/sources/all.ts) leaves it out because Activity is a consolidated read
 * across a matter's whole record, where a counterparty's number is the one field a reader did not
 * come looking for. Who was called is on the Messaging section, behind the same key, one click away.
 */
import Phone from "@lucide/svelte/icons/phone";
import {
  factNumber,
  factText,
  navigateInto,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";
import { channelEntry, durationText } from "./communication-vocabulary.ts";
import { isCommunicationChannel } from "./communications-api.ts";

export const communicationActivityContribution: ActivityContribution = {
  sourceKey: "communication",
  section: "Messaging",
  noun: "Call",
  // A sentence per channel rather than one covering both: a timeline reads as a sequence of things
  // that happened, and "a communication was recorded" is not one of them. The source emits the
  // channel as the row's kind precisely so this can be said properly.
  happened: (kind) => {
    switch (kind) {
      case "voice": {
        return "A call was recorded";
      }
      case "mms": {
        return "A text with a picture was recorded";
      }
      default: {
        return "A text was recorded";
      }
    }
  },
  icon: Phone,
  labelMeaning: "Call or text",
  // Two words, not three. A picture message is a text that happens to carry a picture, not a third
  // kind of thing to filter by (owner ruling, 2026-09-08) — communication-vocabulary.ts is where
  // that mapping lives, and this reads it rather than restating it.
  types: ["Call", "Text"],
  // The source projects the raw channel as the row's own type word, which would put `voice` in the
  // Type column. The word a reader sees is the vocabulary's.
  typeOf: (row) =>
    row.typeText !== null && isCommunicationChannel(row.typeText)
      ? channelEntry(row.typeText).label
      : (row.typeText ?? "Call"),
  factsOf: (row) => {
    const result: Fact[] = [];
    // Which way it went. A fact rather than part of the sentence, so the sentence stays one line and
    // the reader still learns the thing they most want to know after "a call happened".
    const direction = factText(row.facts, "direction");
    if (direction !== null)
      result.push({ value: direction === "inbound" ? "Incoming" : "Outgoing" });
    const length = durationText(factNumber(row.facts, "durationSeconds"));
    if (length !== null) result.push({ label: "Length", value: length });
    // A carrier-written row and a member's recollection of the same call carry different weight, so
    // the chronology says which. Only the hand-written case is marked: once the carrier is
    // connected, most rows are its own and a badge on every one of them stops being read.
    if (factText(row.facts, "producer") === "member") result.push({ value: "Written down after" });
    return result;
  },
  open: navigateInto,
};
