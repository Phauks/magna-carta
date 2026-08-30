/*
 * Naming the people a packet is held for.
 *
 * The register stores owners, depositors and entity borrowers as directory handles and resolves
 * none of them — deliberately, because the register has no business duplicating the directory's
 * display rules, and a report that carried owner names would be a list of the most sensitive things
 * a firm holds with the names attached.
 *
 * So the join happens here, and it is ONE REQUEST FOR A WHOLE PAGE. The directory's naming read
 * takes many handles and answers display identity only — no identifier, no contact detail, no
 * decrypt — which is what makes it cheap enough to call for every row on screen and safe enough to
 * call from a report. It replaced the per-handle detail read this module used to loop over, and that
 * is what let the holdings-by-owner report grow an Owner column at all: at one request per row, a
 * page of owners was the N+1 every listing in this product is written to avoid.
 *
 * A handle nothing answers for stays unnamed. The surface then renders the gap rather than the
 * handle, which is the same rule the docket applies to a member it cannot name.
 */
import { MAX_ENTITY_NAME_LOOKUP, readDirectoryEntityNames } from "$lib/directory/directory-api.ts";

/** The fields a directory detail read carries that stand for a name, in the order they are preferred. */
interface EntityNameFields {
  displayName?: string | null;
  legalName?: string | null;
  prefix?: string | null;
  given?: string | null;
  middle?: string | null;
  family?: string | null;
  suffix?: string | null;
}

/**
 * The name to show, from whichever fields the record carries.
 *
 * `displayName` is the directory's own answer and wins where it is set. A person without one is
 * assembled from the name parts the record holds, in the order they were recorded, because a
 * directory person always has parts even when nobody wrote a display name.
 *
 * The naming read applies this same rule server-side, so this survives for the surfaces that hold a
 * whole detail record in hand and have no reason to ask again.
 */
export function entityDisplayName(fields: EntityNameFields): string | null {
  const display = fields.displayName?.trim();
  if (display !== undefined && display !== "") return display;
  const legal = fields.legalName?.trim();
  if (legal !== undefined && legal !== "") return legal;
  const assembled = [fields.prefix, fields.given, fields.middle, fields.family, fields.suffix]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return assembled === "" ? null : assembled;
}

/**
 * The names for a set of handles, resolved in whole batches and held for the life of the surface.
 *
 * A handle already asked for is never asked for again, including one that resolved to nothing: a
 * directory that has no answer will not grow one while a window is open, and re-asking would turn
 * a closed question into a request per render.
 */
export class DirectoryNames {
  #names = $state(new Map<string, string>());
  #asked = new Set<string>();

  /** The name for a handle, or null while it is unresolved or unanswerable. */
  nameOf(entityId: string): string | null {
    return this.#names.get(entityId) ?? null;
  }

  /** Ask for every handle not already asked for. Safe to call again as a record changes. */
  async resolve(fetchImpl: typeof fetch, entityIds: readonly string[]): Promise<void> {
    const wanted = [...new Set(entityIds)].filter((entityId) => !this.#asked.has(entityId));
    if (wanted.length === 0) return;
    for (const entityId of wanted) this.#asked.add(entityId);

    // Chunked at the read's own bound rather than sent whole: the endpoint REFUSES an over-long list
    // rather than truncating it, so a caller that ignored the bound would get nothing instead of the
    // first hundred.
    const next = new Map(this.#names);
    for (let start = 0; start < wanted.length; start += MAX_ENTITY_NAME_LOOKUP) {
      const chunk = wanted.slice(start, start + MAX_ENTITY_NAME_LOOKUP);
      const outcome = await readDirectoryEntityNames(fetchImpl, chunk);
      if (outcome.kind !== "ok") continue;
      for (const entry of outcome.value.data) {
        if (entry.displayName !== null) next.set(entry.entityId, entry.displayName);
      }
    }
    this.#names = next;
  }
}
