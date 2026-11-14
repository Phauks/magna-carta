/*
 * The matter's exhibits over the wire: the `exhibits.*` operations, reached through the generated
 * client. The shapes are the generated ones under the names this surface reads them by, and every
 * call answers the three-outcome `ApiOutcome` the screens render from.
 *
 * Every write carries a fresh idempotency key. A retried write is a second key, which is the
 * member's second press; the server's own retry of one request is what the key protects.
 */
import {
  exhibitsAddExhibitSetMembers,
  exhibitsCreateExhibit,
  exhibitsCreateExhibitSet,
  exhibitsCreateExhibitSetFromFolder,
  exhibitsEditExhibitSet,
  exhibitsFollowExhibitSetFolder,
  exhibitsIssueExhibitSet,
  exhibitsListExhibitSets,
  exhibitsListExhibits,
  exhibitsListSchemePresets,
  exhibitsReadExhibitSet,
  exhibitsRemoveExhibitSetMember,
  exhibitsReorderExhibitSet,
  exhibitsWithdrawExhibit,
  type ExhibitScheme,
  type ExhibitSchemePresets,
  type ExhibitSetDetail,
  type ExhibitSetSummary,
  type MatterExhibit,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type { ExhibitScheme, ExhibitSchemePresets, ExhibitSetDetail, ExhibitSetSummary, MatterExhibit };
export type ExhibitSetMember = ExhibitSetDetail["members"][number];
export type ExhibitDisposition = "filed" | "served" | "exchanged" | "lodged";

/** The two exhibit keys. Building a set is the first; saying that it went out is the second. */
export const MANAGE_EXHIBITS_PERMISSION = "exhibits:manage";
export const ISSUE_EXHIBITS_PERMISSION = "exhibits:issue";

/** How far a list read walks before it stops: a matter's register is bounded on the server too. */
const MOST_PAGES = 100;

function writeKey(): string {
  return crypto.randomUUID();
}

async function attempt<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (caught) {
    return outcomeOf<T>(caught);
  }
}

/** Every page of a cursor-paged read, in order, or the first failure. */
async function everyPage<Item>(
  read: (cursor: string | undefined) => Promise<{ data: { data: Item[]; nextCursor: string | null } }>,
): Promise<ApiOutcome<Item[]>> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const outcome = await attempt(() => read(cursor));
    if (outcome.kind !== "ok") return outcome;
    items.push(...outcome.value.data);
    if (outcome.value.nextCursor === null) break;
    cursor = outcome.value.nextCursor;
  }
  return { kind: "ok", value: items };
}

export function listExhibitSets(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<ExhibitSetSummary[]>> {
  return everyPage((cursor) =>
    exhibitsListExhibitSets({
      fetch: fetchImpl,
      path: { matterId },
      query: cursor === undefined ? {} : { cursor },
      throwOnError: true,
    }),
  );
}

export function listMatterExhibits(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterExhibit[]>> {
  return everyPage((cursor) =>
    exhibitsListExhibits({
      fetch: fetchImpl,
      path: { matterId },
      query: cursor === undefined ? {} : { cursor },
      throwOnError: true,
    }),
  );
}

export function readExhibitSet(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
): Promise<ApiOutcome<ExhibitSetDetail>> {
  return attempt(() =>
    exhibitsReadExhibitSet({ fetch: fetchImpl, path: { matterId, setId }, throwOnError: true }),
  );
}

export function readSchemePresets(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<ExhibitSchemePresets>> {
  return attempt(() =>
    exhibitsListSchemePresets({ fetch: fetchImpl, path: { matterId }, throwOnError: true }),
  );
}

export function createExhibitSet(
  fetchImpl: typeof fetch,
  matterId: string,
  name: string,
): Promise<ApiOutcome<{ id: string }>> {
  return attempt(() =>
    exhibitsCreateExhibitSet({
      fetch: fetchImpl,
      path: { matterId },
      body: { name },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function createExhibitSetFromFolder(
  fetchImpl: typeof fetch,
  matterId: string,
  folderId: string,
  name?: string,
): Promise<ApiOutcome<{ id: string }>> {
  return attempt(() =>
    exhibitsCreateExhibitSetFromFolder({
      fetch: fetchImpl,
      path: { matterId },
      body: name === undefined ? { folderId } : { folderId, name },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

/** Brings a folder-following draft up to date with its folder. */
export function followExhibitSetFolder(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
): Promise<ApiOutcome<{ addedMemberIds: string[]; removedMemberIds: string[] }>> {
  return attempt(() =>
    exhibitsFollowExhibitSetFolder({
      fetch: fetchImpl,
      path: { matterId, setId },
      body: {},
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function editExhibitSet(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  change: { name?: string; scheme?: Partial<ExhibitScheme>; archived?: true },
): Promise<ApiOutcome<unknown>> {
  return attempt(() =>
    exhibitsEditExhibitSet({
      fetch: fetchImpl,
      path: { matterId, setId },
      body: change,
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function createExhibit(
  fetchImpl: typeof fetch,
  matterId: string,
  fileId: string,
  title: string,
): Promise<ApiOutcome<{ id: string; referenceName: string }>> {
  return attempt(() =>
    exhibitsCreateExhibit({
      fetch: fetchImpl,
      path: { matterId },
      body: { fileId, title },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function addExhibitSetMembers(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  exhibitIds: string[],
): Promise<ApiOutcome<{ memberIds: string[] }>> {
  return attempt(() =>
    exhibitsAddExhibitSetMembers({
      fetch: fetchImpl,
      path: { matterId, setId },
      body: { exhibitIds },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function removeExhibitSetMember(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  memberId: string,
): Promise<ApiOutcome<unknown>> {
  return attempt(() =>
    exhibitsRemoveExhibitSetMember({
      fetch: fetchImpl,
      path: { matterId, setId, memberId },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function reorderExhibitSet(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  memberIds: string[],
): Promise<ApiOutcome<unknown>> {
  return attempt(() =>
    exhibitsReorderExhibitSet({
      fetch: fetchImpl,
      path: { matterId, setId },
      body: { memberIds },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function issueExhibitSet(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  disposition: ExhibitDisposition,
  issuedOn: string,
): Promise<ApiOutcome<unknown>> {
  return attempt(() =>
    exhibitsIssueExhibitSet({
      fetch: fetchImpl,
      path: { matterId, setId },
      body: { disposition, issuedOn },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}

export function withdrawExhibit(
  fetchImpl: typeof fetch,
  matterId: string,
  setId: string,
  memberId: string,
  basis: string,
): Promise<ApiOutcome<unknown>> {
  return attempt(() =>
    exhibitsWithdrawExhibit({
      fetch: fetchImpl,
      path: { matterId, setId, memberId },
      body: { basis },
      headers: { "idempotency-key": writeKey() },
      throwOnError: true,
    }),
  );
}
