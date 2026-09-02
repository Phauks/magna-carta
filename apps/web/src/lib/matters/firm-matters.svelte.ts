/*
 * The firm's matters, for any surface that has to let somebody CHOOSE one.
 *
 * A FIRM-WIDE PICKER CANNOT ASSUME A MATTER, and that is what makes this the whole record rather
 * than a page of it. The time sheet picks a matter per row; the custody register picks the matter a
 * packet is held under. Either way a picker that quietly offered the first fifty matters would look
 * exactly like a picker that offered them all, and the matter somebody wanted would simply not be
 * there. So this walks the listing to its end and holds the answer for the session.
 *
 * WHY IT IS READ ONCE AND NOT REFRESHED. Matters open and close at the pace of a working week, not
 * of a keystroke, and a re-read behind a picker somebody is typing into would swap the list under
 * their hands. The read happens when the surface that needs it first opens, which is also the first
 * moment anybody needs it: nothing is spent on it before then.
 *
 * WHERE IT STOPS AND WHY IT SAYS SO. The walk is bounded, because an unbounded loop against a
 * server is a loop that can never be reasoned about. A firm whose record runs past the bound gets
 * the pages that were read plus a stated fact that the list is not the whole record, and the
 * surfaces above render that rather than pretending the list is complete.
 */
import { listEveryMatter, type MatterSummary } from "$lib/matters/matters-api.ts";
import type { SheetMatter } from "$lib/matters/matter-choice.ts";

/**
 * How many pages the walk will read before it stops and says it stopped.
 *
 * Ten pages of the firm's matters is far past what a picker can be typed through, and it is a
 * bound rather than a target: a firm inside it gets the whole record and never sees the notice.
 */
const MOST_PAGES_READ = 10;

/** A matter as the picker offers it, from the matter as the listing answers it. */
function sheetMatterOf(matter: MatterSummary): SheetMatter {
  return { id: matter.id, matterNumber: matter.matterNumber, title: matter.title };
}

export class FirmMatters {
  /** Null until the first read lands: the loading state, distinct from a firm with no matters. */
  matters = $state<readonly SheetMatter[] | null>(null);
  /** What to say when the matters could not be read; null while it is fine or still in flight. */
  failure = $state<string | null>(null);
  /** Whether the record continues past what was read, so the surfaces can say the list is capped. */
  capped = $state(false);

  /** The read in flight, so a second caller joins it rather than starting a second walk. */
  #inFlight: Promise<void> | null = null;

  /** The matter behind an identifier, or undefined where it is not in what was read. */
  byIdentifier(matterId: string | null): SheetMatter | undefined {
    if (matterId === null) return undefined;
    return (this.matters ?? []).find((matter) => matter.id === matterId);
  }

  /**
   * Read the firm's matters, at most once. Safe to call from an effect: the first call does the
   * work, the rest await it, and a call after it has landed is a no-op.
   */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.matters !== null) return;
    this.#inFlight ??= this.#walk(fetchImpl);
    await this.#inFlight;
  }

  async #walk(fetchImpl: typeof fetch): Promise<void> {
    const collected: SheetMatter[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MOST_PAGES_READ; page += 1) {
      const outcome = await listEveryMatter(fetchImpl, cursor === undefined ? {} : { cursor });
      if (outcome.kind !== "ok") {
        // A failure settles as an empty list plus a sentence, because the matters are never the
        // subject of the surface asking for them: the sheet still opens, and the picker beside the
        // sentence is empty rather than absent.
        this.matters = collected;
        this.failure =
          outcome.kind === "problem" && outcome.problem.status === 403
            ? "Your account cannot read the firm's matters, so a row cannot be filed on one here."
            : "The firm's matters could not be read, so a row cannot be filed on one here.";
        this.#inFlight = null;
        return;
      }
      collected.push(...outcome.value.data.map(sheetMatterOf));
      const next = outcome.value.nextCursor;
      if (next === null) {
        this.matters = collected;
        this.failure = null;
        this.capped = false;
        this.#inFlight = null;
        return;
      }
      cursor = next;
    }
    this.matters = collected;
    this.failure = null;
    this.capped = true;
    this.#inFlight = null;
  }
}
