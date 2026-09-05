/*
 * The links a setting carries, as the Links tab reads them.
 *
 * Two kinds ride one read: the continuance the setting is part of (written only by the continue
 * operation, and already on the record as continued-from and continued-to), and the settings a
 * person RELATED it to by hand. The tab lists the related ones with the other end's title; which
 * end is "other", and which settings may still be related, are decided here and asserted without
 * a browser.
 */
import type { EventLink } from "./calendar-api.ts";

/** One end of a link, as the window opens it. */
export interface LinkEnd {
  readonly kind: "event" | "firmEvent";
  readonly id: string;
}

/** A related link as the tab lists it: the other end, and its title where this reader may see it. */
export interface RelatedLink {
  readonly id: string;
  readonly note: string | null;
  readonly other: LinkEnd;
  readonly title: string | null;
}

function endOf(end: EventLink["from"]): LinkEnd | null {
  if (end.matterEventId !== null) return { kind: "event", id: end.matterEventId };
  if (end.firmEventId !== null) return { kind: "firmEvent", id: end.firmEventId };
  return null;
}

/** The end of a link that is not `self`, or null for a link that does not leave `self`. */
export function otherEnd(link: EventLink, self: LinkEnd): LinkEnd | null {
  for (const end of [endOf(link.from), endOf(link.to)]) {
    if (end !== null && !(end.kind === self.kind && end.id === self.id)) return end;
  }
  return null;
}

/** The links a person related by hand; the continuance kinds are already on the record. */
export function relatedLinksOf(links: readonly EventLink[]): readonly EventLink[] {
  return links.filter((link) => link.kind === "related");
}

/** The settings still open to relating: not this one, and not one already related. */
export function relateChoices(
  candidates: readonly { readonly id: string; readonly startsOn: string; readonly title: string }[],
  selfId: string,
  alreadyRelated: ReadonlySet<string>,
): readonly { readonly value: string; readonly label: string }[] {
  return candidates
    .filter((event) => event.id !== selfId && !alreadyRelated.has(event.id))
    .map((event) => ({ value: event.id, label: `${event.startsOn} · ${event.title}` }));
}

/** How the window names a related end whose title this reader may not see. */
export function unseenEndLabel(end: LinkEnd): string {
  return end.kind === "event" ? "A setting you cannot see" : "A firm event";
}
