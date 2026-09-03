/*
 * How the calendar's rows read on the matter's Activity section: an event by its title and where it
 * is held, a deadline by its title and whether it is overdue, a firm event by the fact of it.
 */
import Building2 from "@lucide/svelte/icons/building-2";
import CalendarClock from "@lucide/svelte/icons/calendar-clock";
import CalendarDays from "@lucide/svelte/icons/calendar-days";
import {
  capitalised,
  factText,
  navigateInto,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";

export const matterEventActivityContribution: ActivityContribution = {
  sourceKey: "matterEvent",
  section: "Calendar",
  noun: "Event",
  happened: "An event was recorded",
  icon: CalendarDays,
  labelMeaning: "Event type",
  types: ["Event"],
  // The event's own type name where the firm gave it one — a Hearing, a Deposition — else Event.
  typeOf: (row) => row.typeText ?? "Event",
  factsOf: (row) => {
    const result: Fact[] = [];
    const startsAtTime = factText(row.facts, "startsAtTime");
    if (startsAtTime !== null) result.push({ label: "At", value: startsAtTime });
    const location = factText(row.facts, "locationText");
    if (location !== null) result.push({ value: location });
    const courtReference = factText(row.facts, "courtReference");
    if (courtReference !== null) result.push({ label: "Court reference", value: courtReference });
    const status = factText(row.facts, "status");
    if (status !== null && status !== "scheduled") {
      result.push({
        value: capitalised(status),
        tone: status === "cancelled" ? "danger" : "muted",
      });
    }
    return result;
  },
  open: navigateInto,
};

export const matterDeadlineActivityContribution: ActivityContribution = {
  sourceKey: "matterDeadline",
  section: "Calendar",
  noun: "Deadline",
  happened: "A deadline was recorded",
  icon: CalendarClock,
  labelMeaning: "State",
  types: ["Deadline"],
  factsOf: (row, context) => {
    const result: Fact[] = [];
    const state = factText(row.facts, "state");
    const dueOn = factText(row.facts, "dueOn");
    // Overdue is a comparison against today, made here where the reader is — never a stored fact.
    if (state === "open" && dueOn !== null && dueOn < context.today) {
      result.push({ value: "Overdue", tone: "danger" });
    } else if (state !== null && state !== "open") {
      result.push({ value: capitalised(state), tone: "muted" });
    }
    const authority = factText(row.facts, "authorityText");
    if (authority !== null) result.push({ label: "Authority", value: authority });
    return result;
  },
  open: navigateInto,
};

// Firm-anchored: it belongs to no matter, so it never appears on a matter's activity. The
// contribution exists so the registry pairing stays complete and a firm-wide activity read inherits
// it the day one is built.
export const firmEventActivityContribution: ActivityContribution = {
  sourceKey: "firmEvent",
  section: "Firm",
  noun: "Firm event",
  happened: "A firm-wide event was recorded",
  icon: Building2,
  labelMeaning: "Event type",
  types: ["Firm event"],
  open: navigateInto,
};
