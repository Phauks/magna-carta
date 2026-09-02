/*
 * The detail behind an activity row, read from the subsystem that owns it.
 *
 * THE TIMELINE DELIBERATELY CARRIES ALMOST NO WORDS, and that stays true: a source declares whether
 * it has a non-privileged label, most declare none, and the federated read spans matters — a note's
 * first eight words or a mail subject projected there is exactly the disclosure the label discipline
 * exists to prevent. The answer the architecture already gives is "follow the link into the owning
 * subsystem's own access-gated read". This module follows it EAGERLY, for the page on screen, and
 * nothing about the server's posture changes: the same reads a person could make by opening the
 * Files or Notes section themselves, made once, on a matter they are already standing inside.
 *
 * ONE LOADER PER SOURCE, AND ADDING ONE IS ADDING AN ENTRY. A source with no loader renders exactly
 * as it did — the sentence, the actor, the link — so this is additive by construction and a screen
 * is never waiting on a subsystem that has nothing to say.
 *
 * WHAT IT DOES NOT DO IS FETCH PER ROW. Each loader makes ONE bounded read of its own subsystem and
 * matches by row identity, so twenty document rows cost one request rather than twenty. The cost of
 * that is real and stated: a loader reads its subsystem's own first page, so a row further back in
 * the chronology than that page reaches shows its sentence without detail. Silently correct, never
 * wrong — an absent detail is an absent line, not a mistaken one.
 */
import { listMatterFiles } from "$lib/file-manager/matter-file-api.ts";
import { listMatterDeadlines, listMatterEvents } from "$lib/matters/calendar-api.ts";
import { listMatterCosts } from "$lib/matters/cost-api.ts";
import { listMatterNotes } from "$lib/matters/notes-api.ts";
import { hoursFromMinutes, listMatterTimeEntries } from "$lib/matters/time-api.ts";

/** What the owning subsystem can say about one row, beyond the fact that it happened. */
export interface ActivityDetail {
  /** The row's own name, as its subsystem names it — a file name, a note's opening line. */
  readonly title: string;
  /** One more fact worth the width: a type, a size, a state. */
  readonly secondary?: string;
}

/**
 * What a loader is handed besides the transport.
 *
 * `money` comes from the surface rather than from the design system, and deliberately: importing the
 * table package's formatter here would pull its Svelte components into a module the node-environment
 * tests load, and this file has no business needing a browser to be tested.
 */
export interface DetailLoaderContext {
  readonly money: (amount: number, currency: string) => string;
}

/** Reads one subsystem's own page and indexes it by the row identity the timeline carries. */
type DetailLoader = (
  fetchImpl: typeof fetch,
  matterId: string,
  context: DetailLoaderContext,
) => Promise<ReadonlyMap<string, ActivityDetail>>;

/** A note's opening line, trimmed to something that sits on a row without pushing it around. */
function openingLine(body: string): string {
  const firstLine = body.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length <= 120 ? firstLine : `${firstLine.slice(0, 119)}…`;
}

/** Bytes as a person reads them. Absent where the record holds no size. */
function sizeText(sizeBytes: number | null): string | undefined {
  if (sizeBytes === null) return undefined;
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  const kilobytes = sizeBytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  return `${(kilobytes / 1024).toFixed(kilobytes / 1024 < 10 ? 1 : 0)} MB`;
}

const LOADERS: Readonly<Record<string, DetailLoader>> = {
  // A document. The timeline's row id IS the file's id, which is what makes the match exact rather
  // than a guess from a name two documents could share.
  documentFiled: async (fetchImpl, matterId) => {
    const outcome = await listMatterFiles(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(
      outcome.value.data.map((file) => [
        file.id,
        {
          title: file.name,
          secondary: [
            file.versionNumber > 1 ? `Version ${String(file.versionNumber)}` : undefined,
            sizeText(file.sizeBytes),
            // A document the scanner refused, or has not read yet, is a fact about the file worth
            // seeing beside it here rather than only in the Files section.
            file.status === "quarantined"
              ? "Quarantined"
              : file.status === "pending"
                ? "Awaiting scan"
                : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(" · "),
        },
      ]),
    );
  },
  // A note. Its words are behind the matter's own notes permission, which is the gate this read
  // passes; a member who may not read notes gets a refusal here and rows without detail.
  matterNote: async (fetchImpl, matterId) => {
    const outcome = await listMatterNotes(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(outcome.value.data.map((note) => [note.id, { title: openingLine(note.body) }]));
  },
  // Time. The narrative is what the work was, which is the only thing worth leading a row with; the
  // hours and whether it is billable ride beside it.
  timeEntry: async (fetchImpl, matterId) => {
    const outcome = await listMatterTimeEntries(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(
      outcome.value.data.map((entry) => [
        entry.id,
        {
          title: openingLine(entry.narrative),
          secondary: [
            `${hoursFromMinutes(entry.durationMinutes)} h`,
            entry.billable ? undefined : "Non-billable",
            entry.timekeeperName ?? undefined,
          ]
            .filter((part) => part !== undefined)
            .join(" · "),
        },
      ]),
    );
  },
  // A cost. Its description names what was bought; the amount is the fact anybody scanning wants.
  costEntry: async (fetchImpl, matterId, context) => {
    const outcome = await listMatterCosts(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(
      outcome.value.data.map((cost) => [
        cost.id,
        {
          title: openingLine(cost.description),
          secondary: [
            context.money(cost.amountMinor / 100, cost.currency),
            cost.vendorName ?? undefined,
          ]
            .filter((part) => part !== undefined)
            .join(" · "),
        },
      ]),
    );
  },
  // An event. Its title is what a person calls the hearing, and where it is held is the second thing
  // they look for.
  matterEvent: async (fetchImpl, matterId) => {
    const outcome = await listMatterEvents(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(
      outcome.value.data.map((event) => [
        event.id,
        {
          title: event.title,
          secondary: [event.eventTypeName ?? undefined, event.locationText ?? undefined]
            .filter((part) => part !== undefined)
            .join(" · "),
        },
      ]),
    );
  },
  // A deadline. Whether it is overdue is the fact that changes what somebody does about it, so it is
  // stated here rather than left for the Calendar section to reveal.
  matterDeadline: async (fetchImpl, matterId) => {
    const outcome = await listMatterDeadlines(fetchImpl, matterId);
    if (outcome.kind !== "ok") return new Map();
    return new Map(
      outcome.value.data.map((deadline) => [
        deadline.id,
        {
          title: deadline.title,
          secondary: [deadline.overdue ? "Overdue" : undefined, deadline.authorityText ?? undefined]
            .filter((part) => part !== undefined)
            .join(" · "),
        },
      ]),
    );
  },
};

/** Which sources this build can say more about. Named for the tests, and for the next loader. */
export const DETAILED_SOURCE_KEYS: readonly string[] = Object.keys(LOADERS);

/**
 * The detail for the rows on screen, held for one matter.
 *
 * Every loader runs once per matter and the results are kept: the chronology pages, and a second
 * page of activity must not re-read every subsystem. A loader that fails contributes nothing and
 * says nothing — its rows keep their sentences, which is the state they were designed to render in.
 */
export class ActivityDetails {
  #details = $state<ReadonlyMap<string, ActivityDetail>>(new Map());
  /** Which matter the held detail belongs to, so a change of matter discards it. */
  #subject: string | null = null;
  #generation = 0;

  /** True when this index is already holding (or loading) the given matter. */
  showing(matterId: string): boolean {
    return this.#subject === matterId;
  }

  /** Discard and adopt a new matter. */
  reset(matterId: string): void {
    this.#subject = matterId;
    this.#generation += 1;
    this.#details = new Map();
  }

  /** What the owning subsystem says about this row, or undefined where nothing does. */
  detailFor(sourceKey: string, rowId: string): ActivityDetail | undefined {
    return this.#details.get(`${sourceKey}:${rowId}`);
  }

  /**
   * Run every declared loader for this matter, folding what each returns into one index.
   *
   * Concurrent, because they read unrelated subsystems and a serial pass would make the slowest one
   * decide when any detail appears. Each is absorbed as it lands, so the fast ones show immediately.
   */
  async load(
    fetchImpl: typeof fetch,
    matterId: string,
    context: DetailLoaderContext,
  ): Promise<void> {
    const generation = this.#generation;
    await Promise.all(
      Object.entries(LOADERS).map(async ([sourceKey, loader]) => {
        const loaded = await loader(fetchImpl, matterId, context);
        if (generation !== this.#generation) return;
        const merged = new Map(this.#details);
        for (const [rowId, detail] of loaded) merged.set(`${sourceKey}:${rowId}`, detail);
        this.#details = merged;
      }),
    );
  }
}
