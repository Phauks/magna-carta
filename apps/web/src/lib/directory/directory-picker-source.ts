/*
 * The directory as the entity picker searches it — the ONE adapter between the firm's ranked name
 * search and the design system's picker, so every surface that picks a person or an organization
 * asks the same question and words the same answer.
 *
 * The picker never fetches; it takes a search. This is that search. It maps a hit to what the picker
 * shows through the same naming rule every other surface uses, and it carries the one fact a ranked
 * answer has to carry — that it is capped — so the picker can say so instead of dressing the best few
 * matches as the firm's whole record.
 *
 * A search that could not run is thrown, not returned empty: the picker turns a rejection into its
 * failed state, and a failed fetch must never look like an empty directory.
 */
import type {
  EntityPickerAnswer,
  EntitySearch,
  PickableEntity,
} from "@magna-carta/design-system/entity-picker";
import type { EntityKind } from "@magna-carta/design-system/entity-identity";
import { searchDirectory, type DirectorySearchHit } from "./directory-api.ts";
import { nameRoleLabel } from "./directory-vocabulary.ts";

/**
 * What the picker shows beneath a hit: which of the entity's names the query actually landed on,
 * when it was not the current one, and what that name is to them. A reader who typed a maiden name
 * and sees only the current name cannot tell they found the right file; a reader who typed the
 * current name needs nothing said.
 */
export function pickableAside(hit: DirectorySearchHit): string | undefined {
  if (hit.matchedNameIsCurrent) return undefined;
  return `Matched on ${hit.matchedName} · ${nameRoleLabel(hit.matchedNameRole)}`;
}

function pickableKind(hit: DirectorySearchHit): EntityKind {
  return hit.entityKind === "organization" ? "organization" : "person";
}

export function pickableEntityFrom(hit: DirectorySearchHit): PickableEntity {
  const aside = pickableAside(hit);
  return {
    identifier: hit.entityId,
    name: hit.displayName,
    kind: pickableKind(hit),
    ...(aside === undefined ? {} : { aside }),
  };
}

/**
 * The search a picker over the firm's directory is handed.
 *
 * `kinds` narrows what is offered: the search itself answers over both sides of the directory, and a
 * picker that must offer only persons (a judge) or only organizations (a court) leaves the other out
 * here, before the picker sees it. The abort signal is accepted and not yet forwarded — the request
 * helper takes none — and that is safe because the picker also discards an answer that arrives after
 * a newer question is out.
 */
export function directoryPickerSearch(
  fetchImpl: typeof fetch,
  options: { kinds?: readonly EntityKind[] } = {},
): EntitySearch {
  const offered = options.kinds === undefined ? null : new Set(options.kinds);
  return async (query: string): Promise<EntityPickerAnswer> => {
    const outcome = await searchDirectory(fetchImpl, query);
    if (outcome.kind !== "ok") {
      throw new Error("Couldn't search the directory.");
    }
    const hits = outcome.value.data
      .map(pickableEntityFrom)
      .filter((hit) => offered === null || offered.has(hit.kind));
    return { hits, capped: outcome.value.capped };
  };
}
