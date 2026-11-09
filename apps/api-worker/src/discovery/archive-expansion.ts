import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { advanceLoadedDocumentCountStatement } from "@magna-carta/discovery/load-statements";
import { insertReviewDocumentStatement } from "@magna-carta/discovery/review-document-statements";
import { advanceReviewSetDocumentCountStatement } from "@magna-carta/discovery/review-set-statements";
import { completeUploadSession, initiateUpload } from "@magna-carta/file-manager/file-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  DiscoveryLoadId,
  MatterId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { z } from "zod";
import type { Bindings } from "../bindings.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";

// A CONTAINER FAMILY IS A CHAIN-OF-CUSTODY CLAIM. A document pulled out of an archive is evidence
// whose provenance is the archive, and the archive's provenance is the party that sent it. That is
// what the family records: the archive is the parent, every entry is a `container-child` carrying the
// path it had inside, and one indexed read reconstructs the whole thing years later.
//
// WHY THIS EXISTS AT ALL, given that the platform stores uploaded archives opaque and never opens
// them. A production received from another party arrives as a zip; a discovery subsystem that cannot
// open one cannot ingest an external production, which is half of what discovery is for. So the
// exception is deliberately narrow: it lives in the discovery processing lane and nowhere else, and
// an archive a member uploads to the File Manager is as opaque as it ever was.
//
// EVERY GUARD IS THE ENGINE'S, AND NOT ONE OF THEM IS RESTATED HERE. Nesting depth, total expanded
// bytes, expansion ratio, entry count and path traversal are all enforced in
// crates/discovery-core/src/archive.rs before a decompressed byte is retained — a ceiling applied to
// bytes already in memory has already lost. This module reads the engine's answer and never decides
// for itself whether an entry was safe to open.
//
// AN ARCHIVE IS A TRANSPORT, NOT A TRUST BOUNDARY. Every entry that comes out re-enters the ordinary
// ingest gate — the same presign-shaped session, the same magic-byte sniff against the real bytes,
// the same content hash, the same malware scan — by the same path an email attachment takes in
// emails/attachment-extraction.ts. There is no discovery bypass, and there is deliberately no second
// way to put bytes in a firm's bucket.
//
// THE ORIGINAL IS NEVER TOUCHED. The archive stays exactly as it arrived, at its own key, as the
// as-received evidence copy; everything here is a new object.

// The engine's expansion response, validated at the trust boundary before anything downstream reads
// it, on the same terms the reading response is. The engine reports more than this and the rest is
// simply not read.
const ExpansionSchema = z.object({
  entries: z.array(
    z.object({
      path: z.string(),
      // Base64, because a JSON document cannot carry bytes. Bounded by the engine's own per-entry
      // and total ceilings before it is ever encoded.
      bytes: z.string(),
      depth: z.number().int().nonnegative(),
    }),
  ),
  skipped: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      depth: z.number().int().nonnegative(),
    }),
  ),
  totalExpandedBytes: z.number().int().nonnegative(),
});

export type ArchiveExpansion = z.infer<typeof ExpansionSchema>;

const EngineErrorSchema = z.object({ code: z.string() });

export type ArchiveExpansionResult =
  | { readonly ok: true; readonly expansion: ArchiveExpansion }
  // The archive as a whole tripped a guard, or is not readable as an archive at all. Terminal for
  // this document and named, because "this container tripped an expansion guard" is a sentence a
  // firm can put in front of a court and "expansion failed" is not.
  | { readonly ok: false; readonly kind: "refused"; readonly code: string }
  // The engine is not deployed, or did not answer. Not a verdict on the archive.
  | { readonly ok: false; readonly kind: "unavailable"; readonly detail: string };

export interface ArchiveExpansionPort {
  expand(bytes: Uint8Array): Promise<ArchiveExpansionResult>;
}

export function resolveArchiveExpansionPort(env: Bindings): ArchiveExpansionPort | undefined {
  const discovery = env.DISCOVERY_SERVICE;
  if (discovery === undefined) return undefined;
  return {
    async expand(bytes: Uint8Array): Promise<ArchiveExpansionResult> {
      let response: Response;
      try {
        response = await discovery.fetch(
          new Request("http://discovery/archive/expand", { method: "POST", body: bytes }),
        );
      } catch (error) {
        return {
          ok: false,
          kind: "unavailable",
          detail: error instanceof Error ? error.message : "discovery engine error",
        };
      }
      if (response.status === 422) {
        const named = EngineErrorSchema.safeParse(await response.json());
        return {
          ok: false,
          kind: "refused",
          code: named.success ? named.data.code : "containerGuardTripped",
        };
      }
      if (response.status !== 200) {
        return { ok: false, kind: "unavailable", detail: `discovery engine ${response.status}` };
      }
      const parsed = ExpansionSchema.safeParse(await response.json());
      if (!parsed.success) {
        return { ok: false, kind: "unavailable", detail: "expansion response did not validate" };
      }
      return { ok: true, expansion: parsed.data };
    },
  };
}

export interface ContainerChildPlan {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sequence: number;
}

// The entries that will become documents, in a stable order. Sorted by path so a re-processing of
// the same archive assigns the same sequence to the same entry — a family sequence that depended on
// the order a decoder happened to walk the central directory would renumber a production between one
// run and the next.
export function planContainerChildren(expansion: ArchiveExpansion): ContainerChildPlan[] {
  return [...expansion.entries]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((entry, index) => ({
      path: entry.path,
      bytes: decodeBase64(entry.bytes),
      // One-based, and the parent keeps zero: a family read ordered by sequence puts the container
      // ahead of what came out of it, which is the order a person reads a family in.
      sequence: index + 1,
    }));
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// The last path segment, which is the name a person would call the entry. The full path stays on the
// row as `source_path`, so nesting inside the container survives into the manifest.
export function entryDisplayName(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

export interface ContainerChildIngestInput {
  readonly env: Bindings;
  readonly database: BatchDatabase;
  readonly bucketName: string;
  readonly matterId: MatterId;
  readonly reviewSetId: ReviewSetId;
  readonly discoveryLoadId: DiscoveryLoadId;
  readonly recordCustodianId: RecordCustodianId;
  readonly parentReviewDocumentId: ReviewDocumentId;
  readonly uploadedBy: UserId;
  readonly child: ContainerChildPlan;
  readonly now: () => string;
}

// One entry, all the way from bytes to a queued review document.
//
// THE ORDER IS THE CORRECTNESS RULE. The file session is opened and the bytes are written before any
// review document names them, so a crash never leaves a corpus row pointing at an object that is not
// there. The ingest event is enqueued LAST, after the review document exists, so the gate's verdict
// can only land on a document the corpus already knows about.
export async function ingestContainerChild(
  input: ContainerChildIngestInput,
): Promise<{ readonly reviewDocumentId: ReviewDocumentId; readonly r2Key: string }> {
  const { env, database, child } = input;
  const initiated = await initiateUpload(
    database,
    {
      matterId: input.matterId,
      name: entryDisplayName(child.path),
      declaredSize: child.bytes.byteLength,
      // Deliberately not declared. The entry's name inside an archive is the other side's claim
      // about what it is, and the gate sniffs the real bytes; declaring a type here would be feeding
      // that claim into the check meant to test it.
      declaredContentType: null,
      uploadedBy: input.uploadedBy,
      mode: "put",
      uploadKind: "bulk",
    },
    { clock: { now: input.now }, actorUserId: input.uploadedBy },
  );
  await commitEffectBatch(database, initiated.effect, { now: input.now });

  const { bucket, bucketName } = resolveFirmBucket(env, input.bucketName);
  await bucket.put(initiated.r2Key, child.bytes, { customMetadata: initiated.dimensions });

  const completed = await completeUploadSession(
    database,
    initiated.uploadSessionId as UploadSessionId,
    { clock: { now: input.now }, actorUserId: input.uploadedBy },
  );

  const reviewDocumentId = newIdentifier("reviewDocument");
  const now = input.now();
  await commitEffectBatch(
    database,
    {
      statements: [
        ...completed.effect.statements,
        insertReviewDocumentStatement(
          database,
          {
            id: reviewDocumentId,
            reviewSetId: input.reviewSetId,
            discoveryLoadId: input.discoveryLoadId,
            recordCustodianId: input.recordCustodianId,
            sourceKind: "file_version",
            fileVersionId: initiated.versionId,
            emailMessageId: null,
            // THE FAMILY. The archive's own identifier is the family identifier, so the container and
            // everything that came out of it are one indexed read — the read a production and a
            // privilege call both make, and the one a broken family is discovered by.
            familyId: input.parentReviewDocumentId,
            familyRole: "container-child",
            familySequence: child.sequence,
            sourceName: entryDisplayName(child.path),
            // The path INSIDE the container, kept whole. Nesting the engine flattened is still
            // legible here, which is how a reader of the manifest can see where in the production a
            // document actually sat.
            sourcePath: child.path,
            sizeBytes: child.bytes.byteLength,
            // Left for the gate. The hash the corpus deduplicates and reconciles on is the one the
            // ingest pipeline computes over the bytes it actually read, not one computed here from
            // the same buffer twice.
            contentSha256: null,
          },
          now,
        ),
        // The children are documents this load brought in, so the load's own arithmetic has to grow
        // by them. Until they reach a terminal state the reconciliation will not balance, which is
        // exactly right: the load is not complete while a document it produced is unread.
        advanceLoadedDocumentCountStatement(database, input.discoveryLoadId, 1, now),
        advanceReviewSetDocumentCountStatement(database, input.reviewSetId, 1, now),
      ],
      outboxMessages: completed.effect.outboxMessages,
    },
    { now: input.now },
  );

  // The gate runs on the bytes exactly as it does for an upload: sniff, hash, scan, then commit or
  // quarantine. Enqueued after the review document exists so a verdict can never arrive for a
  // document the corpus has not heard of.
  await enqueueDevIngestEvent(env, bucketName, initiated.r2Key, child.bytes.byteLength);
  return { reviewDocumentId, r2Key: initiated.r2Key };
}

// What the container's own metadata sidecar states: what came out, and — the part that matters for a
// report about absence — what did not, and why. An entry the engine described rather than opened is
// a document that exists and that nobody read, and the only place that fact can live is here and in
// the exception the container carries.
export interface ContainerSidecar {
  readonly reviewDocumentId: string;
  readonly reviewSetId: string;
  readonly discoveryLoadId: string;
  readonly formatIdentified: string;
  readonly expandedAt: string;
  readonly totalExpandedBytes: number;
  readonly children: readonly {
    readonly reviewDocumentId: string;
    readonly path: string;
    readonly familySequence: number;
  }[];
  readonly notExpanded: readonly {
    readonly path: string;
    readonly reason: string;
    readonly depth: number;
  }[];
}
