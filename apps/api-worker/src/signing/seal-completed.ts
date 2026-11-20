import {
  commitEffectBatch,
  guarded,
  type BatchDatabase,
} from "@magna-carta/data-access/effect-batch";
import { completeUploadSession, initiateUpload } from "@magna-carta/file-manager/file-service";
import type {
  FileId,
  FolderId,
  FileVersionId,
  SigningRequestId,
  UploadSessionId,
} from "@magna-carta/identifiers/types";
import { isResolvableTimeZone, zonedReading } from "@magna-carta/civil-time/time-zone";
import type { SigningEvent, SignerCompletion } from "@magna-carta/signing/esign";
import type { SealMark, SealPort, SignatureImage } from "@magna-carta/signing/port";
import { SealFailedError, SealNotConfiguredError } from "../documents/seal-port-binding.ts";
import {
  event,
  readRequestDetail,
  SIGNING_GUARD,
  type SigningRequestDetail as RequestDetail,
} from "./request-service.ts";
import {
  insertEventStatement,
  markSealedStatement,
  readMemberName,
  readSealPlacement,
  readVersionObjectKey,
  type SigningFieldRow,
  type SigningSignerRow,
} from "./statements.ts";

// Sealing a request once everyone has signed: what the signers gave is drawn into their boxes, the
// platform seal is applied over the result, and the signed copy is filed as a new version of the
// document with its Certificate of Completion filed beside it.
//
// It runs off the request path. The finish that completes a request raises an outbox message, and the
// per-firm queue hands it here; the hourly signing pass seals any completed request that message did
// not reach. Both arrive at the same function, which does nothing to a request already sealed.
//
// The document sealed is the version that was sent, checked against the digest recorded when it was
// sent. A copy whose bytes differ is not sealed, because a certificate must describe what the signers
// were shown.

/** What sealing needs from the deployment, injected so a test can stand in for each. */
export interface SealingDependencies {
  readonly sealPort: SealPort;
  readonly bucket: R2Bucket;
  /** The bucket's name, as the ingest event carries it. */
  readonly bucketName: string;
  /** Hands a server-written object to the ingest, which scans it and makes the version current. */
  readonly ingest: (bucketName: string, key: string, size: number) => Promise<void>;
  readonly firmName: string;
  readonly now: () => string;
}

export type SealOutcome =
  | {
      readonly kind: "sealed";
      readonly signedVersionId: FileVersionId;
      readonly certificateFileId: FileId;
    }
  /** Not completed, already sealed, or gone: nothing to do. */
  | { readonly kind: "skipped" }
  /** The sent version is missing or its bytes no longer match what was sent. */
  | { readonly kind: "document-changed" }
  /** The sealing service has no signing identity yet; the hourly pass tries again. */
  | { readonly kind: "not-configured" }
  /** The sealing service refused these bytes for good. */
  | { readonly kind: "refused" };

/** How long the hourly pass leaves a just-completed request to the prompt sealing. */
export const SEAL_BACKSTOP_DELAY_MILLISECONDS = 15 * 60 * 1000;

export async function sealCompletedRequest(
  database: BatchDatabase,
  requestId: SigningRequestId,
  dependencies: SealingDependencies,
): Promise<SealOutcome> {
  const detail = await readRequestDetail(database, requestId);
  if (
    detail === undefined ||
    detail.request.status !== "completed" ||
    detail.request.sealedAt !== null ||
    detail.request.documentHashSha256 === null
  ) {
    return { kind: "skipped" };
  }
  const placement = await readSealPlacement(database, detail.request.fileId);
  if (placement === undefined) return { kind: "skipped" };

  const sentKey = await readVersionObjectKey(database, detail.request.fileVersionId);
  const sent = sentKey === undefined ? null : await dependencies.bucket.get(sentKey);
  if (sent === null) return { kind: "document-changed" };
  const document = new Uint8Array(await sent.arrayBuffer());
  if ((await sha256Hex(document)) !== detail.request.documentHashSha256) {
    return { kind: "document-changed" };
  }

  const pictures = new PictureStore(dependencies.bucket);
  const zone =
    placement.timeZone !== null && isResolvableTimeZone(placement.timeZone)
      ? placement.timeZone
      : "UTC";
  const marks = await marksFor(detail, pictures, zone);
  const signers = detail.signers.filter((signer) => signer.status === "signed");
  const signatureImages = await picturesBySigner(detail, signers, "signature", pictures);
  const initialsImages = await picturesBySigner(detail, signers, "initials", pictures);
  const now = dependencies.now();

  let sealed: Awaited<ReturnType<SealPort["seal"]>>;
  try {
    sealed = await dependencies.sealPort.seal({
      document,
      signers: signers.map((signer) => completionOf(detail, signer)),
      signingTime: now,
      seal: { reason: "Signed by every party" },
      envelope: {
        id: detail.request.id,
        title: detail.request.title,
        sender: { name: await readMemberName(database, detail.request.createdByUserId) },
        ...(dependencies.firmName !== "" ? { contact: { name: dependencies.firmName } } : {}),
        createdAt: detail.request.createdAt,
      },
      events: auditEvents(detail),
      marks,
      markPictures: pictures.list(),
      ...(signatureImages.length > 0 ? { signatureImages } : {}),
      ...(initialsImages.length > 0 ? { initialsImages } : {}),
    });
  } catch (error) {
    if (error instanceof SealNotConfiguredError) return { kind: "not-configured" };
    if (error instanceof SealFailedError) return { kind: "refused" };
    throw error;
  }

  const options = { clock: { now: () => now }, actorUserId: detail.request.createdByUserId };
  const signedVersion = await fileBytes(database, dependencies, {
    input: {
      matterId: detail.request.matterId,
      fileId: detail.request.fileId,
      name: placement.fileName,
    },
    bytes: sealed.sealedPdf,
    options,
  });
  const certificate = await fileBytes(database, dependencies, {
    input: {
      matterId: detail.request.matterId,
      folderId: placement.folderId as FolderId | null,
      name: certificateFileName(placement.fileName),
    },
    bytes: sealed.certificatePdf,
    options,
  });

  await commitEffectBatch(
    database,
    {
      statements: [
        guarded(
          markSealedStatement(
            database,
            detail.request.id,
            signedVersion.versionId,
            certificate.fileId,
            now,
          ),
          SIGNING_GUARD.moved,
        ),
        insertEventStatement(
          database,
          event(detail.request.id, "sealed", now, { detail: sealed.certificate.reference }),
        ),
      ],
      outboxMessages: [],
    },
    { now: () => now },
  );
  return {
    kind: "sealed",
    signedVersionId: signedVersion.versionId,
    certificateFileId: certificate.fileId,
  };
}

/** The certificate's file name: the document's own name with what it is, as a PDF. */
export function certificateFileName(documentName: string): string {
  const stem = documentName.replace(/\.pdf$/i, "");
  return `${stem} - Certificate of Completion.pdf`;
}

/**
 * Reserve a version (or a new file), write the bytes to its key, complete it, and hand it to the
 * ingest, which scans it and makes it current. The same four steps an upload takes, so a server-written
 * document is checked as a member's is.
 */
async function fileBytes(
  database: BatchDatabase,
  dependencies: SealingDependencies,
  filing: {
    readonly input: {
      readonly matterId: RequestDetail["request"]["matterId"];
      readonly fileId?: FileId;
      readonly folderId?: FolderId | null;
      readonly name: string;
    };
    readonly bytes: Uint8Array;
    readonly options: Parameters<typeof initiateUpload>[2];
  },
): Promise<{ readonly fileId: FileId; readonly versionId: FileVersionId }> {
  const initiated = await initiateUpload(
    database,
    {
      ...filing.input,
      declaredSize: filing.bytes.length,
      declaredContentType: "application/pdf",
      uploadedBy: filing.options.actorUserId ?? null,
      mode: "put",
      uploadKind: "interactive",
    },
    filing.options,
  );
  await commitEffectBatch(database, initiated.effect, { now: filing.options.clock.now });
  await dependencies.bucket.put(initiated.r2Key, filing.bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: initiated.dimensions,
  });
  const completed = await completeUploadSession(
    database,
    initiated.uploadSessionId as UploadSessionId,
    filing.options,
  );
  await commitEffectBatch(database, completed.effect, { now: filing.options.clock.now });
  await dependencies.ingest(dependencies.bucketName, initiated.r2Key, filing.bytes.length);
  return { fileId: initiated.fileId, versionId: initiated.versionId };
}

/** Each adopted picture read once from the bucket and sent once, however many boxes it fills. */
class PictureStore {
  private readonly indexByKey = new Map<string, number>();
  private readonly bytes: Uint8Array[] = [];

  constructor(private readonly bucket: R2Bucket) {}

  /** The picture's position in the list sent with the marks, or null when the object is gone. */
  async indexOf(key: string): Promise<number | null> {
    const known = this.indexByKey.get(key);
    if (known !== undefined) return known;
    const object = await this.bucket.get(key);
    if (object === null) return null;
    this.bytes.push(new Uint8Array(await object.arrayBuffer()));
    const index = this.bytes.length - 1;
    this.indexByKey.set(key, index);
    return index;
  }

  async bytesOf(key: string): Promise<Uint8Array | null> {
    const index = await this.indexOf(key);
    return index === null ? null : (this.bytes[index] ?? null);
  }

  list(): Uint8Array[] {
    return [...this.bytes];
  }
}

/** What each completed field draws, in the order the fields were placed. */
async function marksFor(
  detail: RequestDetail,
  pictures: PictureStore,
  zone: string,
): Promise<SealMark[]> {
  const signerById = new Map(detail.signers.map((signer) => [signer.id, signer] as const));
  const marks: SealMark[] = [];
  for (const field of detail.fields) {
    const signer = signerById.get(field.signerId);
    if (signer === undefined || signer.status !== "signed" || field.valueText === null) continue;
    const content = await contentOf(field, signer, pictures, zone);
    if (content !== null) marks.push({ page: field.page, rect: field.rect, content });
  }
  return marks;
}

async function contentOf(
  field: SigningFieldRow,
  signer: SigningSignerRow,
  pictures: PictureStore,
  zone: string,
): Promise<SealMark["content"] | null> {
  switch (field.kind) {
    case "signature":
    case "initials": {
      const key = field.kind === "signature" ? signer.signatureObjectKey : signer.initialsObjectKey;
      if (key === null) return null;
      const picture = await pictures.indexOf(key);
      return picture === null ? null : { kind: "picture", picture };
    }
    case "checkbox":
      return field.valueText === "checked" ? { kind: "check" } : null;
    case "date-signed":
      return drawableText(signedDate(field.valueText ?? "", zone));
    default:
      return drawableText(field.valueText ?? "");
  }
}

/**
 * A line of text the engine's standard fonts can draw, or nothing. The fonts draw Windows-1252, so a
 * name in another script is left off the page rather than refusing the seal; the certificate still
 * prints it, in a typeface that can.
 */
function drawableText(text: string): SealMark["content"] | null {
  const trimmed = text.trim();
  if (trimmed === "" || ![...trimmed].every(isWindows1252)) return null;
  return { kind: "text", text: trimmed };
}

/** The characters Windows-1252 places above 0x7F that are not in Latin-1's own positions. */
const WINDOWS_1252_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function isWindows1252(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WINDOWS_1252_EXTRAS.has(character);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The day a signer signed, in the matter's office's zone, written out: "November 16, 2026". */
export function signedDate(instant: string, zone: string): string {
  const milliseconds = Date.parse(instant);
  if (Number.isNaN(milliseconds)) return "";
  const [year, month, day] = zonedReading(milliseconds, zone).civilDate.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? "" : `${name} ${Number(day)}, ${year}`;
}

/** The pictures one signer adopted, with the pages each was placed on, for the certificate. */
async function picturesBySigner(
  detail: RequestDetail,
  signers: readonly SigningSignerRow[],
  kind: "signature" | "initials",
  pictures: PictureStore,
): Promise<SignatureImage[]> {
  const out: SignatureImage[] = [];
  for (const signer of signers) {
    const key = kind === "signature" ? signer.signatureObjectKey : signer.initialsObjectKey;
    if (key === null) continue;
    const image = await pictures.bytesOf(key);
    if (image === null) continue;
    const pages = [
      ...new Set(
        detail.fields
          .filter((field) => field.signerId === signer.id && field.kind === kind)
          .map((field) => field.page),
      ),
    ].sort((first, second) => first - second);
    out.push({ signerId: signer.id, image, ...(pages.length > 0 ? { pages } : {}) });
  }
  return out;
}

/** One signer's record on the certificate, from what the request observed and stored. */
function completionOf(detail: RequestDetail, signer: SigningSignerRow): SignerCompletion {
  const signed = detail.events.find((one) => one.kind === "signed" && one.signerId === signer.id);
  const own = detail.fields.filter((field) => field.signerId === signer.id);
  return {
    intent: {
      signerId: signer.id,
      name: signer.name,
      ...(signer.email !== "" ? { email: signer.email } : {}),
      adoption: signer.adoption ?? "typed",
      signatureCount: own.filter((field) => field.kind === "signature").length,
      initialCount: own.filter((field) => field.kind === "initials").length,
      affirmedAt: signer.signedAt ?? signed?.at ?? detail.request.completedAt ?? "",
    },
    consent: {
      disclosureVersion: signer.consentDisclosureVersion ?? "",
      consentedAt: signer.consentedAt ?? "",
    },
    attribution: {
      level: signer.attributionLevel,
      ...(signed?.observedIp !== null && signed?.observedIp !== undefined
        ? { observedIp: signed.observedIp }
        : {}),
      ...(signed?.userAgent !== null && signed?.userAgent !== undefined
        ? { userAgent: signed.userAgent }
        : {}),
      ...codeDestinationOf(signer),
    },
  };
}

/**
 * Where the signer's code went, for the certificate: the address in full, as the request was sent
 * to it, or a texted number by its last four digits alone.
 */
function codeDestinationOf(
  signer: Pick<SigningSignerRow, "attributionLevel" | "codeChannel" | "email" | "mobileNumber">,
): { codeDestination?: string } {
  if (signer.attributionLevel !== "access-code") return {};
  if (signer.codeChannel === "text") {
    return signer.mobileNumber === null
      ? {}
      : { codeDestination: `Text to the number ending ${signer.mobileNumber.slice(-4)}` };
  }
  return signer.email === "" ? {} : { codeDestination: signer.email };
}

/**
 * The steps the request recorded, for the certificate's audit log. Each signer's consent and
 * signature are printed from their own record, so those two kinds are not repeated here.
 */
function auditEvents(detail: RequestDetail): SigningEvent[] {
  return detail.events
    .filter((one) => one.kind !== "consented" && one.kind !== "signed")
    .map((one) => ({
      kind: one.kind,
      at: one.at,
      ...(one.actor !== null ? { actor: one.actor } : {}),
      ...(one.observedIp !== null ? { observedIp: one.observedIp } : {}),
      ...(one.userAgent !== null ? { userAgent: one.userAgent } : {}),
      ...(one.detail !== null ? { detail: one.detail } : {}),
    }));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
