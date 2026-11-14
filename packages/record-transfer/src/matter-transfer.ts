import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { runDomainEffect } from "@magna-carta/data-access/run-domain-effect";
import {
  assertEntityExists,
  MergedEntityError,
  UnknownEntityError,
} from "@magna-carta/directory/entity-kind";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { isMatterNumberConflict } from "@magna-carta/matters/matter-statements";
import { composeTransferredMatter } from "@magna-carta/matters/transferred-matter";
import { MatterValidationError } from "@magna-carta/matters/validation";
import type { TransferTarget } from "./directory-transfer.ts";
import type { MatterDraft, MatterReference } from "./matter-mapping.ts";
import {
  insertSourceRecordLinkStatement,
  selectLinkedLocalRecordStatement,
  selectLinksForSourceRecordStatement,
} from "./source-record-link-statements.ts";

// The matters half of the loader: one source matter becomes one matter here, once, with its client
// and its parties, in one commit with its link.
//
// A matter is written only when every record it names has already arrived. A matter created without
// one of its parties would lose a fact, and because a second run leaves an existing matter alone the
// fact would never be put back. So a matter whose client or party has no Directory record yet is
// not written at all: the outcome names what is missing, and the matter arrives on the run after
// those records do.

export interface MatterTransferContext {
  readonly database: BatchDatabase;
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export type MatterTransferOutcome =
  | { readonly outcome: "created"; readonly localId: MatterId }
  | { readonly outcome: "alreadyLinked"; readonly localId: MatterId }
  // Nothing was written. `missing` lists each reference that names no live Directory record: one
  // not transferred yet, one transferred as both a person and an organization, or one deleted since.
  | { readonly outcome: "referencesNotTransferred"; readonly missing: readonly MatterReference[] }
  // Nothing was written, and running again will not help until the source or the firm's records
  // change. `matterNumberTaken`: another matter here already wears the number.
  // `matterNumberNotUsable`: the number holds a character a matter number may not.
  | { readonly outcome: "refused"; readonly reason: "matterNumberTaken" | "matterNumberNotUsable" };

const DIRECTORY_TABLES: ReadonlySet<string> = new Set([
  "directory_person",
  "directory_organization",
]);

export async function transferMatter(
  context: MatterTransferContext,
  target: TransferTarget,
  draft: MatterDraft,
): Promise<MatterTransferOutcome> {
  const { database } = context;
  const { results } = await selectLinkedLocalRecordStatement(
    database,
    target.source,
    "matter",
  ).all<{
    local_id: string;
  }>();
  const existing = results[0]?.local_id;
  if (existing !== undefined) return { outcome: "alreadyLinked", localId: existing as MatterId };

  const missing: MatterReference[] = [];
  const resolve = async (reference: MatterReference): Promise<string | null> => {
    const entityId = await directoryRecordOf(database, target.source.sourceSystem, reference);
    if (entityId === null) {
      missing.push({ sourceKind: reference.sourceKind, sourceId: reference.sourceId });
    }
    return entityId;
  };
  const clientEntityId = draft.client === null ? null : await resolve(draft.client);
  const parties: { entityId: string; role: string }[] = [];
  for (const party of draft.parties) {
    const entityId = await resolve(party);
    if (entityId !== null) parties.push({ entityId, role: party.role });
  }
  if (missing.length > 0) return { outcome: "referencesNotTransferred", missing };

  let composed;
  try {
    composed = composeTransferredMatter(
      database,
      {
        title: draft.title,
        description: draft.description,
        matterNumber: draft.matterNumber,
        matterTypeId: draft.matterTypeId,
        locationId: null,
        responsibleMemberId: draft.responsibleMemberId,
        clientDisplayName: draft.clientDisplayName,
        openedAt: draft.openedAt,
        closedAt: draft.closedAt,
        clientEntityId,
        parties,
      },
      context,
    );
  } catch (caught) {
    if (caught instanceof MatterValidationError && caught.code === "matter-number-not-url-safe") {
      return { outcome: "refused", reason: "matterNumberNotUsable" };
    }
    throw caught;
  }

  const { matterId, statements } = composed;
  const link = insertSourceRecordLinkStatement(
    database,
    {
      source: target.source,
      localTable: "matter",
      localId: matterId,
      transferRunId: target.transferRunId,
    },
    context.clock.now(),
  );
  try {
    // The matter's rows and its link, in one commit. The link insert carries no conflict clause, so
    // a second writer of the same source matter fails whole and leaves no second matter behind.
    await runDomainEffect(database, undefined, context.clock, "matter", () => ({
      statements: [...statements, link],
      outboxMessages: [],
      responseCode: 201,
      responseBody: { id: matterId },
      value: matterId,
      fromBody: (body) => (body as { id: MatterId }).id,
    }));
  } catch (caught) {
    if (isMatterNumberConflict(caught)) return { outcome: "refused", reason: "matterNumberTaken" };
    throw caught;
  }
  return { outcome: "created", localId: matterId };
}

// The live Directory record a source record became, or null when there is not exactly one. A record
// merged into another since it arrived resolves to the survivor: the link still names the record
// that arrived, which keeps the history true, and a new party belongs on the one that is live.
async function directoryRecordOf(
  database: BatchDatabase,
  sourceSystem: string,
  reference: MatterReference,
): Promise<string | null> {
  const { results } = await selectLinksForSourceRecordStatement(database, {
    sourceSystem,
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
  }).all<{ local_table: string; local_id: string }>();
  const linked = results.filter((row) => DIRECTORY_TABLES.has(row.local_table));
  if (linked.length !== 1 || linked[0] === undefined) return null;

  let entityId = linked[0].local_id;
  // A merge chain is short; the bound only stops a loop that corrupt data could otherwise make.
  for (let hop = 0; hop < 8; hop += 1) {
    try {
      await assertEntityExists(database, entityId);
      return entityId;
    } catch (caught) {
      if (caught instanceof MergedEntityError && caught.masterId !== "") {
        entityId = caught.masterId;
        continue;
      }
      if (caught instanceof UnknownEntityError || caught instanceof MergedEntityError) return null;
      throw caught;
    }
  }
  return null;
}
