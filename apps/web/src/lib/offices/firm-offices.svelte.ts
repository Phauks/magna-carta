/*
 * The firm's offices, read once and shared.
 *
 * The picker and the link both want the same short list, and a read per surface would be the
 * same request several times on one page. So the read is here, it happens once, and a second
 * caller joins the request already in flight. On the firm roster's pattern
 * ($lib/members/firm-roster.svelte.ts), for the same reasons.
 *
 * NOT cached across sessions or refreshed on a timer: offices change when the firm opens or closes
 * one, which is a page-load-scale event. A surface that just wrote an office calls `reload` so the
 * next reader sees it.
 */
import { listOffices, type OfficeSummary } from "./offices-api.ts";

export class FirmOffices {
  /** Null until the read lands — the loading state, distinct from a firm with no offices. */
  offices = $state<readonly OfficeSummary[] | null>(null);
  /** What to say when the list could not be read; null while it is fine or still in flight. */
  failure = $state<string | null>(null);

  #inFlight: Promise<void> | null = null;

  /** The offices still open — what a picker offers. */
  get active(): readonly OfficeSummary[] {
    return (this.offices ?? []).filter((office) => office.status === "active");
  }

  /** One office by handle, open or closed, or undefined where the firm has none by that handle. */
  byId(id: string | null): OfficeSummary | undefined {
    if (id === null) return undefined;
    return (this.offices ?? []).find((office) => office.id === id);
  }

  /** Read the list, at most once; a call after it has landed is a no-op. */
  async load(fetchImpl: typeof fetch): Promise<void> {
    if (this.offices !== null) return;
    this.#inFlight ??= this.#read(fetchImpl);
    await this.#inFlight;
  }

  /** Read the list again, after a write. */
  async reload(fetchImpl: typeof fetch): Promise<void> {
    this.#inFlight ??= this.#read(fetchImpl);
    await this.#inFlight;
  }

  async #read(fetchImpl: typeof fetch): Promise<void> {
    const outcome = await listOffices(fetchImpl);
    if (outcome.kind === "ok") {
      this.offices = outcome.value.data;
      this.failure = null;
    } else {
      // Never the subject of the screen it is read on, so a failure settles as an empty list plus a
      // sentence beside the control that is now empty, and the screen itself stands.
      this.offices = [];
      this.failure = "The firm's offices could not be read.";
    }
    this.#inFlight = null;
  }
}

export const firmOffices = new FirmOffices();
