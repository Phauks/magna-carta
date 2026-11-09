/*
 * The matter names a conversation rail cites beneath its rows.
 *
 * A conversation carries the identifier of the matter its transcript is kept on and not the
 * matter's name, and the name is the matters subsystem's to declare rather than this surface's to
 * invent -- so it is read from the matter's own record. The reads are deduplicated across the rows
 * of a page, capped, and remembered, because a rail of fifty rows rarely names more than a handful
 * of matters, and none of them may cost the rail anything: a name that cannot be read leaves the
 * citation absent, which is the honest rendering of "not known", where a placeholder word would be
 * this screen naming somebody else's record.
 */
import { resolveMatterRecord } from "$lib/matters/matter-record.ts";

/**
 * How many matters one pass will name. A page of conversations spans a few matters in practice;
 * the cap is what stops a pathological page from firing a read per row.
 */
const NAMES_PER_PASS = 12;

export class MatterCitations {
  #titles = $state<Record<string, string>>({});
  #numbers = $state<Record<string, string>>({});
  readonly #asked = new Set<string>();
  readonly #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    this.#fetchImpl = fetchImpl;
  }

  /** The matter's name, or null while it is unknown. */
  titleFor(matterId: string): string | null {
    return this.#titles[matterId] ?? null;
  }

  /** The matter's number, or null while it is unknown or the matter has not drawn one yet. */
  numberFor(matterId: string): string | null {
    return this.#numbers[matterId] ?? null;
  }

  /** Forget everything, for a surface that has changed subject. */
  reset(): void {
    this.#titles = {};
    this.#numbers = {};
    this.#asked.clear();
  }

  /** Read the names this page needs and has not asked for before. */
  async resolve(matterIds: readonly (string | null)[]): Promise<void> {
    const wanted: string[] = [];
    for (const matterId of matterIds) {
      if (matterId === null || this.#asked.has(matterId)) continue;
      this.#asked.add(matterId);
      wanted.push(matterId);
      if (wanted.length === NAMES_PER_PASS) break;
    }
    if (wanted.length === 0) return;
    const records = await Promise.all(
      wanted.map((matterId) => resolveMatterRecord(this.#fetchImpl, matterId)),
    );
    const found: Record<string, string> = { ...this.#titles };
    const numbers: Record<string, string> = { ...this.#numbers };
    records.forEach((record, index) => {
      const matterId = wanted[index];
      if (record === undefined || matterId === undefined) return;
      found[matterId] = record.title;
      const number = record.matterNumber ?? record.consultationNumber ?? record.intakeNumber;
      if (number !== null) numbers[matterId] = number;
    });
    this.#titles = found;
    this.#numbers = numbers;
  }
}
