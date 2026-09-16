/*
 * The matters a call or a text may be filed onto.
 *
 * THIS IS NOT THE DOCKET, AND THE DIFFERENCE IS THE OWNER'S RULING OF 2026-09-07: a text may be on
 * an intake or a consultation, it does not need a number, but it needs a status of some kind.
 *
 * `listEveryMatter` in $lib/matters/matters-api.ts deliberately excludes intakes — it serves the
 * firm's docket, and "a docket that listed every phone call would bury the firm's files under its
 * own front door". That reasoning is right for a docket and wrong here, for the same underlying
 * fact: an intake IS a phone call, and this is the surface that files them. So this walks the third
 * stream too, and a picker built on it can offer the anchor a first contact actually lands on.
 *
 * A PICKER THAT FILTERED TO OPEN MATTERS WOULD MAKE THE COMMON CASE UNROUTABLE. That is the mistake
 * this module exists to prevent, and it is why the streams are named here rather than left to each
 * caller to remember.
 *
 * READ ONCE, NOT REFRESHED. Matters open at the pace of a working week, not of a keystroke, and a
 * re-read behind a picker somebody is typing into would swap the list under their hands. The walk is
 * bounded, because an unbounded loop against a server is a loop nobody can reason about; a firm past
 * the bound gets what was read plus a stated fact that it is not the whole record.
 */
import { listMatters, type MatterSummary } from "$lib/matters/matters-api.ts";
import type { SheetMatter } from "$lib/time/time-sheet-model.ts";

/** The three streams that together are every matter a conversation may be anchored to. */
const ANCHOR_SCOPES = ["caseload", "consultation", "intake"] as const;

/**
 * How many pages of each stream the walk reads before it stops and says it stopped.
 *
 * Six pages per stream is far past what a picker can be typed through, and it is a bound rather than
 * a target: a firm inside it gets the whole record and never sees the notice.
 */
const MOST_PAGES_READ = 6;

/** A matter as the picker offers it, from the matter as the listing answers it. */
function anchorOf(matter: MatterSummary): SheetMatter {
  return {
    id: matter.id,
    // The number a person would quote: the newest one the matter has drawn. An open matter has its
    // own; a consultation has the tentative one it was created with; an intake has the one it was
    // written down under. Every rung has one, so this never falls through to the title.
    matterNumber: matter.matterNumber ?? matter.consultationNumber ?? matter.intakeNumber,
    title: matter.title,
  };
}

export class AnchorMatters {
  /** Null until the first read lands: the loading state, distinct from a firm with no matters. */
  matters = $state<readonly SheetMatter[] | null>(null);
  /** What to say when they could not be read; null while it is fine or still in flight. */
  failure = $state<string | null>(null);
  /** Whether the record continues past what was read, so a surface can say the list is capped. */
  capped = $state(false);

  /** The read in flight, so a second caller joins it rather than starting a second walk. */
  #inFlight: Promise<void> | null = null;

  /** The matter behind an identifier, or undefined where it is not in what was read. */
  byIdentifier(matterId: string | null): SheetMatter | undefined {
    if (matterId === null) return undefined;
    return (this.matters ?? []).find((matter) => matter.id === matterId);
  }

  /**
   * Read the anchors, at most once. Safe to call from an effect: the first call does the work, the
   * rest await it, and a call after it has landed is a no-op.
   */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.matters !== null) return;
    this.#inFlight ??= this.#walk(fetchImpl);
    await this.#inFlight;
  }

  async #walk(fetchImpl: typeof fetch): Promise<void> {
    const collected: SheetMatter[] = [];
    let capped = false;
    for (const scope of ANCHOR_SCOPES) {
      let cursor: string | undefined;
      let pages = 0;
      for (; pages < MOST_PAGES_READ; pages += 1) {
        // Sequential by necessity, not by oversight: each page is addressed by the cursor the
        // previous one returned, so there is no set of requests to issue together.
        const outcome = await listMatters(fetchImpl, {
          scope,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (outcome.kind !== "ok") {
          // A failure settles as what was collected plus a sentence, because the matters are never
          // the subject of the surface asking for them: the form still opens, and the picker beside
          // the sentence is empty rather than absent.
          this.matters = collected;
          this.failure =
            outcome.kind === "problem" && outcome.problem.status === 403
              ? "Your account cannot read the firm's matters, so nothing can be filed onto one here."
              : "The firm's matters could not be read, so nothing can be filed onto one here.";
          this.#inFlight = null;
          return;
        }
        collected.push(...outcome.value.data.map(anchorOf));
        const next = outcome.value.nextCursor;
        if (next === null) break;
        cursor = next;
      }
      if (pages === MOST_PAGES_READ) capped = true;
    }
    // The caseload stream and the consultation stream can both name a matter that has just changed
    // status between the two reads, so the same id can arrive twice. Deduplicated here rather than
    // left for the picker, where a repeated row reads as two matters with one name.
    const seen = new Set<string>();
    this.matters = collected.filter((matter) => {
      if (seen.has(matter.id)) return false;
      seen.add(matter.id);
      return true;
    });
    this.failure = null;
    this.capped = capped;
    this.#inFlight = null;
  }
}
