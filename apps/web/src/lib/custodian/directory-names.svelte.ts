/*
 * Naming the people a packet is held for.
 *
 * The register stores owners, depositors and entity borrowers as directory handles and resolves
 * none of them — deliberately, because the register has no business duplicating the directory's
 * display rules, and a report that carried owner names would be a list of the most sensitive things
 * a firm holds with the names attached.
 *
 * So the join happens here, and it is BOUNDED TO ONE RECORD. A packet carries at most twenty owner
 * links plus a depositor, which is a handful of reads for a record a person opened deliberately.
 * That is the whole reason this is scoped to a packet and not offered to a listing: the directory
 * serves one entity per request, so naming a page of rows would be one request per row, which is
 * the N+1 every listing in this product is written to avoid. A listing that needs owner names needs
 * a directory read that names many entities in one request, and there is no such read today.
 *
 * A handle nothing answers for stays unnamed. The surface then renders the gap rather than the
 * handle, which is the same rule the docket applies to a member it cannot name.
 */
import { requestJson } from "$lib/api/request.ts";

/** The two entity families a custody handle can name. */
function pathFor(entityId: string): string | null {
  if (entityId.startsWith("directoryPerson_")) {
    return `/api/v1/directory/persons/${encodeURIComponent(entityId)}`;
  }
  if (entityId.startsWith("directoryOrganization_")) {
    return `/api/v1/directory/organizations/${encodeURIComponent(entityId)}`;
  }
  return null;
}

/** The fields either detail read may carry that stand for a name, in the order they are preferred. */
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
 * The names for the handles on one record, resolved once and held for the life of the surface.
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

    const resolved = await Promise.all(
      wanted.map(async (entityId) => {
        const path = pathFor(entityId);
        if (path === null) return null;
        const outcome = await requestJson<EntityNameFields>(fetchImpl, path);
        if (outcome.kind !== "ok") return null;
        const name = entityDisplayName(outcome.value);
        return name === null ? null : ([entityId, name] as const);
      }),
    );

    const next = new Map(this.#names);
    for (const entry of resolved) {
      if (entry !== null) next.set(entry[0], entry[1]);
    }
    this.#names = next;
  }
}
