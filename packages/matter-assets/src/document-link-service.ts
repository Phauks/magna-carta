import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, MatterAssetDocumentId, MatterAssetId } from "@magna-carta/identifiers/types";
import { readMatterAsset } from "./asset-statements.ts";
import {
  deleteMatterAssetDocumentStatement,
  insertMatterAssetDocumentStatement,
  readFileMatterId,
  readMatterAssetDocument,
} from "./document-link-statements.ts";
import { MATTER_ASSET_DOCUMENT_KINDS, type MatterAssetDocumentKind } from "./types.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import { MatterAssetValidationError } from "./validation.ts";

// Linking an already-ingested matter file to an asset.
//
// NO BYTES EVER REACH THIS MODULE. Upload is the File Manager's presigned-upload and quarantine
// chokepoint, with no exception and no second path; this service links the resulting handle and
// nothing else. That is what keeps a deed attached to a house an ordinary matter document: still in
// the matter's file list, still previewable, still convertible, still under any legal hold, still in
// discovery. It gained an association and lost nothing.

export interface LinkMatterAssetDocumentInput {
  readonly assetId: MatterAssetId;
  readonly fileId: FileId;
  readonly kind: string;
  readonly note?: string | null;
}

export async function linkMatterAssetDocument(
  database: SqlDatabase,
  input: LinkMatterAssetDocumentInput,
  options: MatterAssetServiceOptions,
): Promise<{ documentLinkId: MatterAssetDocumentId; effect: EffectWrite }> {
  const kinds: readonly string[] = MATTER_ASSET_DOCUMENT_KINDS;
  if (!kinds.includes(input.kind)) {
    throw new MatterAssetValidationError(
      "matter-asset-document-matter-mismatch",
      `no such document kind: ${input.kind}`,
    );
  }
  const asset = await readMatterAsset(database, input.assetId);
  if (asset === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }
  const fileMatterId = await readFileMatterId(database, input.fileId);
  if (fileMatterId === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-document-matter-mismatch",
      "no such file in this firm",
    );
  }
  // A file filed under a different matter is refused rather than linked: an asset's documents are
  // the matter's documents, and a cross-matter link would put a deed in a case nobody could find it
  // from — and would leak one matter's file list into another's asset detail.
  if (fileMatterId !== asset.matter_id) {
    throw new MatterAssetValidationError(
      "matter-asset-document-matter-mismatch",
      "a file filed under another matter cannot be linked to this asset",
    );
  }

  const now = options.clock.now();
  const documentLinkId = newIdentifier("matterAssetDocument", options.randomSource);
  return {
    documentLinkId,
    effect: {
      statements: [
        insertMatterAssetDocumentStatement(database, {
          id: documentLinkId,
          assetId: input.assetId,
          fileId: input.fileId,
          kind: input.kind as MatterAssetDocumentKind,
          note: input.note ?? null,
          linkedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "matterAsset.document.linked",
          subjectId: documentLinkId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: asset.matter_id, assetId: input.assetId, fileId: input.fileId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Unlinking removes the link row and LEAVES THE FILE ALONE: it stays in the matter's file list, in
// its folder, under whatever hold it carries. Audited, because a filing decision reversed is a fact
// somebody may need to account for.
export async function unlinkMatterAssetDocument(
  database: SqlDatabase,
  documentLinkId: MatterAssetDocumentId,
  options: MatterAssetServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterAssetDocument(database, documentLinkId);
  if (existing === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-document-link",
      "no such document link in this firm",
    );
  }
  const asset = await readMatterAsset(database, existing.asset_id);
  return {
    effect: {
      statements: [
        deleteMatterAssetDocumentStatement(database, documentLinkId),
        domainAuditStatement(database, {
          event: "matterAsset.document.unlinked",
          subjectId: documentLinkId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: asset?.matter_id ?? null,
            assetId: existing.asset_id,
            fileId: existing.file_id,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
