// THE ONE DOOR INTO AN ARCHIVE'S CONTENTS: what is inside it, and one member's bytes out of it.
//
// Every archive surface on this platform goes through this module. Not because a dispatcher is
// tidy, but because the three questions an archive raises — what is in it, may this one be taken
// out, and what did taking it cost — were previously answered in three places, in zip's vocabulary,
// with the caps applied by whichever reader happened to run. A second format made that untenable and
// a third would have made it wrong.
//
// WHAT LIVES HERE, AND WHY IT IS ALL ONE PLACE:
//
//   - The FORMAT DISPATCH, for both halves. Listing and extraction have to agree about what a member
//     is: an extractor locates bytes using facts the listing read, so a listing that forgets a
//     member's offset is an extractor that cannot find it. They are written together for that
//     reason, and a member carries its own locator rather than the caller reassembling one.
//   - ONE REFUSAL VOCABULARY, across every format. "Password-protected inside the archive" is the
//     same fact to a reader whether it was a zip's general-purpose flag or a 7z's AES coder that
//     said so, and a surface that had to learn each format's spelling would be a surface that shows
//     one of them as a generic failure.
//   - THE CAPS, applied once. What a firm allows one extraction to produce, and what a whole request
//     may produce across every member it takes, are checked HERE — before any format-specific code
//     runs — so a new extractor cannot be written that forgets them. What only a format can know
//     (does this stream inflate to what it promised) each extractor checks for itself.
//   - THE ACCOUNTING. Every attempt leaves a record of what it cost and why it ended as it did.
//     That is what makes an extraction diagnosable after the fact rather than a count of failures.
//
// ENGINES ARRIVE AS PORTS. A format whose reader needs a compiled engine — today that is 7z, whose
// file list is LZMA-compressed and whose members are packed by real coders — is reached through an
// injected port rather than imported. This package holds no WebAssembly binding and must not: under
// Workers the module is supplied by the bundler at the import site, so importing one here would give
// this package a dependency only one of its consumers could satisfy. It is the same seam
// `MalwareScanPort` uses for the scan engine, for the same reason, and the absent port is an honest
// refusal rather than a crash.
//
// THE CONTAINER IS UNTRUSTED. Every length an archive states about itself is a claim, checked
// against the object's real size and the firm's caps before anything is read or held.
import type { ArchiveFormat } from "./archive-format.ts";
import {
  readZipCentralDirectory,
  type ArchiveSourceBucket,
  type ZipCentralDirectoryEntry,
} from "./zip-central-directory.ts";
import { extractZipMember } from "./zip-member-extract.ts";
import { readTarListing, type TarEntryKind } from "./tar-listing.ts";
import { readRarListing } from "./rar-listing.ts";

/**
 * What an extractor needs to find one member's bytes, in the terms its own format uses.
 *
 * Opaque to every caller: a surface asks for a member by path and hands the member back, never
 * assembling a locator or reading inside one. It is per-format because the formats genuinely differ
 * — a zip member is found through its local header, a tar member is simply at an offset, a 7z member
 * is an index into an archive only the engine can read — and pretending otherwise would mean the
 * least capable format deciding what the others may record.
 */
export type ArchiveMemberLocator =
  | { readonly format: "zip"; readonly entry: ZipCentralDirectoryEntry }
  | { readonly format: "tar"; readonly dataOffset: number; readonly kind: TarEntryKind }
  | { readonly format: "sevenZip"; readonly memberIndex: number; readonly encrypted: boolean }
  | { readonly format: "rar" };

/** One member of an archive, in the one shape every format answers with. */
export interface ArchiveMember {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly compressedSizeBytes: number;
  readonly uncompressedSizeBytes: number;
  readonly modifiedAt: string | null;
  readonly locator: ArchiveMemberLocator;
}

export interface ArchiveContents {
  readonly format: ArchiveFormat;
  readonly members: readonly ArchiveMember[];
  /** There were more members than the firm's entry cap allows to be read. */
  readonly truncated: boolean;
}

/**
 * Why ONE member could not be taken out. Each is a fact about that member, never a generic failure
 * and never a fault of the request — the other members in the same selection still come out.
 */
export type ArchiveExtractionRefusal =
  /** The archive object is gone from storage. */
  | "archive-missing"
  /** The entry names a directory, which has no bytes to take out. */
  | "directory"
  /**
   * The entry is not a file at all: a symbolic or hard link, a device node, a pipe. It has no
   * content of its own, and filing its zero bytes would put an empty document on the matter under a
   * name that promises something else.
   */
  | "not-a-file"
  /** The member's content is encrypted; this platform holds no password for it. */
  | "encrypted"
  /** The member is packed by a method or a coder this platform does not decode. */
  | "unsupported-compression"
  /** The archive's own structure does not hold together where this member should be. */
  | "malformed"
  /** The member is larger than the firm allows, alone or against what this request has already taken. */
  | "too-large"
  /** The member's compression ratio exceeds the firm's ceiling — the decompression-bomb guard. */
  | "expansion-ratio"
  /** The produced bytes disagree with the length or the checksum the archive recorded. */
  | "corrupt";

/**
 * Why a whole ARCHIVE cannot be extracted from. Separate from the per-member vocabulary because it
 * is a different question with a different answer shape: it is settled once, before any member is
 * named, and it is never a fact about a member.
 */
export type ArchiveExtractabilityRefusal =
  /** No extractor exists for this format on this platform. Listing one still works. */
  | "format-not-extractable"
  /** An extractor exists for this format and this deployment did not supply its engine. */
  | "engine-unavailable";

export type ArchiveExtractability =
  | { readonly kind: "extractable" }
  | { readonly kind: "refused"; readonly reason: ArchiveExtractabilityRefusal };

/** What a firm's policy allows extraction to produce. */
export interface ArchiveExtractionLimits {
  /** The largest a single member may produce. */
  readonly maxUncompressedBytes: number;
  /** The most a member may grow relative to its packed size. */
  readonly maxExpansionRatio: number;
  /**
   * The TOTAL every member of one request may produce between them. A hundred members that each pass
   * the per-member ceiling are still a hundred times that ceiling held in one isolate, so the budget
   * is spent as members are taken and the rest are refused rather than extracted.
   */
  readonly requestBudgetBytes: number;
}

/** What one extraction attempt did, whether or not it produced anything. */
export interface ArchiveExtractionAttempt {
  readonly path: string;
  readonly format: ArchiveFormat;
  readonly outcome: "extracted" | "refused";
  /** Null when the member came out. */
  readonly reason: ArchiveExtractionRefusal | null;
  /** What the member's own header said it would produce, before anything was read. */
  readonly declaredBytes: number;
  /** What it actually produced. Zero on a refusal, and equal to `declaredBytes` on a sound member. */
  readonly producedBytes: number;
}

export type ArchiveMemberExtraction =
  | { readonly kind: "ok"; readonly bytes: Uint8Array; readonly member: ArchiveMember }
  | { readonly kind: "refused"; readonly reason: ArchiveExtractionRefusal };

/**
 * The 7z engine, supplied by whoever has the compiled module to hand.
 *
 * Both halves are here rather than only extraction, because a 7z member is addressed by its index in
 * the archive the engine read: a listing from one reader and an extraction from another would be two
 * readings of the same archive that could disagree about which member index four is.
 */
export interface SevenZipEnginePort {
  list(
    bucket: ArchiveSourceBucket,
    key: string,
    limits: { maxEntries: number },
  ): Promise<{
    entries: readonly {
      path: string;
      isDirectory: boolean;
      compressedSizeBytes: number;
      uncompressedSizeBytes: number;
      modifiedAt: string | null;
      encrypted: boolean;
    }[];
    truncated: boolean;
  } | null>;
  extract(
    bucket: ArchiveSourceBucket,
    key: string,
    memberIndex: number,
    limits: { maxUncompressedBytes: number },
  ): Promise<SevenZipExtraction>;
}

export type SevenZipExtraction =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly reason: ArchiveExtractionRefusal };

/** The engines this deployment has. An absent one is a refusal by name, never a crash. */
export interface ArchiveEngines {
  readonly sevenZip?: SevenZipEnginePort;
}

/** A format whose members cannot be read out of the container by anything on this platform. */
const NOT_EXTRACTABLE: ReadonlySet<ArchiveFormat> = new Set<ArchiveFormat>([
  // Listing a rar walks its block headers and needs no decoder at all, which is what made it
  // buildable here. Decoding a rar member's packed data is a different thing entirely: there is no
  // memory-safe decoder for it, and the reference implementation's licence forbids reusing its code
  // to write one. Browsing a rar therefore works and taking a member out does not, and that is the
  // honest boundary rather than a gap waiting to be filled.
  "rar",
]);

/**
 * Whether members can be taken out of an archive of this format at all, in this deployment.
 *
 * Asked once per archive, before any member is named, so a surface can refuse the act with the
 * format's own reason instead of refusing every member one at a time with the same sentence.
 */
export function archiveExtractability(
  format: ArchiveFormat,
  engines: ArchiveEngines,
): ArchiveExtractability {
  if (NOT_EXTRACTABLE.has(format)) return { kind: "refused", reason: "format-not-extractable" };
  if (format === "sevenZip" && engines.sevenZip === undefined) {
    return { kind: "refused", reason: "engine-unavailable" };
  }
  return { kind: "extractable" };
}

/**
 * Read what an archive holds, or null when the object is gone.
 *
 * One ranged-read walk of the format's own headers — a zip's central directory, a tar's chain of
 * member headers, a rar's block chain, a 7z's header at the end of the file. No archive is fetched
 * and nothing is unpacked to answer this.
 *
 * A format's reader throwing is that reader's business (a zip with no readable end structures raises
 * `ZipCentralDirectoryError`, the 7z engine raises its own); this does not flatten those into null,
 * because "the object is gone" and "these bytes are not the archive they claim to be" are different
 * answers and a caller acts differently on each.
 */
export async function readArchiveContents(
  format: ArchiveFormat,
  bucket: ArchiveSourceBucket,
  key: string,
  limits: { maxEntries: number },
  engines: ArchiveEngines = {},
): Promise<ArchiveContents | null> {
  switch (format) {
    case "zip": {
      const listing = await readZipCentralDirectory(bucket, key, limits);
      if (listing === null) return null;
      return {
        format,
        truncated: listing.truncated,
        members: listing.entries.map((entry) => ({
          path: entry.path,
          isDirectory: entry.isDirectory,
          compressedSizeBytes: entry.compressedSizeBytes,
          uncompressedSizeBytes: entry.uncompressedSizeBytes,
          modifiedAt: entry.modifiedAt,
          locator: { format: "zip", entry },
        })),
      };
    }
    case "tar": {
      const listing = await readTarListing(bucket, key, limits);
      if (listing === null) return null;
      return {
        format,
        truncated: listing.truncated,
        members: listing.entries.map((entry) => ({
          path: entry.path,
          isDirectory: entry.isDirectory,
          compressedSizeBytes: entry.compressedSizeBytes,
          uncompressedSizeBytes: entry.uncompressedSizeBytes,
          modifiedAt: entry.modifiedAt,
          locator: { format: "tar", dataOffset: entry.dataOffset, kind: entry.kind },
        })),
      };
    }
    case "rar": {
      const listing = await readRarListing(bucket, key, limits);
      if (listing === null) return null;
      return {
        format,
        truncated: listing.truncated,
        members: listing.entries.map((entry) => ({
          path: entry.path,
          isDirectory: entry.isDirectory,
          compressedSizeBytes: entry.compressedSizeBytes,
          uncompressedSizeBytes: entry.uncompressedSizeBytes,
          modifiedAt: entry.modifiedAt,
          locator: { format: "rar" },
        })),
      };
    }
    case "sevenZip": {
      const engine = engines.sevenZip;
      // A deployment with no 7z engine can still be asked to list one. Answering null would say the
      // object is gone, which is false, so the absence surfaces as a throw the caller maps — the
      // same shape a format reader's own refusal takes.
      if (engine === undefined) throw new SevenZipEngineUnavailableError();
      const listing = await engine.list(bucket, key, limits);
      if (listing === null) return null;
      return {
        format,
        truncated: listing.truncated,
        members: listing.entries.map((entry, memberIndex) => ({
          path: entry.path,
          isDirectory: entry.isDirectory,
          compressedSizeBytes: entry.compressedSizeBytes,
          uncompressedSizeBytes: entry.uncompressedSizeBytes,
          modifiedAt: entry.modifiedAt,
          locator: { format: "sevenZip", memberIndex, encrypted: entry.encrypted },
        })),
      };
    }
  }
}

/** Raised when a 7z is asked of a deployment that has no engine for one. */
export class SevenZipEngineUnavailableError extends Error {
  constructor() {
    super("No 7z engine is wired into this deployment.");
    this.name = "SevenZipEngineUnavailableError";
  }
}

/**
 * One request's extraction from one archive: the members it takes, the budget they share, and the
 * record of what each attempt did.
 *
 * Held as a session rather than a bare function because the budget is the whole reason: what a
 * member is allowed to produce depends on what the members before it already produced, so the
 * decision cannot be made per call without the caller keeping the running total — which is exactly
 * the accounting that belongs here.
 */
export class ArchiveExtraction {
  private readonly membersByPath: ReadonlyMap<string, ArchiveMember>;
  private readonly record: ArchiveExtractionAttempt[] = [];
  private budgetRemaining: number;
  /** Once the budget is gone it stays gone: a smaller later member must not slip past a refused one. */
  private budgetSpent = false;

  constructor(
    private readonly bucket: ArchiveSourceBucket,
    private readonly key: string,
    private readonly contents: ArchiveContents,
    private readonly limits: ArchiveExtractionLimits,
    private readonly engines: ArchiveEngines = {},
  ) {
    this.membersByPath = new Map(contents.members.map((member) => [member.path, member]));
    this.budgetRemaining = limits.requestBudgetBytes;
  }

  /** Every attempt this session made, in the order it made them. */
  get attempts(): readonly ArchiveExtractionAttempt[] {
    return this.record;
  }

  /** What this session produced in total, which is what it spent of the request's budget. */
  get producedBytes(): number {
    return this.record.reduce((total, attempt) => total + attempt.producedBytes, 0);
  }

  /** Whether the archive holds a member at this path, as the listing read it. */
  holds(path: string): boolean {
    return this.membersByPath.has(path);
  }

  /**
   * Take one member's bytes, or say why not.
   *
   * The checks that do not depend on the format run first and in one place: a directory or a
   * non-file has nothing to give, a member whose own header already exceeds the firm's ceiling is
   * refused before a byte is read, and a member that would carry this request past its total budget
   * is refused without being read at all. Only then does the member's own format get a say.
   */
  async take(path: string): Promise<ArchiveMemberExtraction> {
    const member = this.membersByPath.get(path);
    if (member === undefined) {
      // The caller is expected to have asked `holds` first; a path the listing never held is not an
      // extraction outcome and is deliberately not recorded as one.
      return { kind: "refused", reason: "malformed" };
    }
    const declaredBytes = member.uncompressedSizeBytes;

    if (member.isDirectory) return this.refuse(path, declaredBytes, "directory");
    if (member.locator.format === "tar" && member.locator.kind !== "file") {
      return this.refuse(path, declaredBytes, "not-a-file");
    }
    if (declaredBytes > this.limits.maxUncompressedBytes) {
      return this.refuse(path, declaredBytes, "too-large");
    }
    if (this.budgetSpent || declaredBytes > this.budgetRemaining) {
      // Every member after this one is refused too: a request whose budget ran out has run out, and
      // filing the small members that happen to follow a large one would make the result depend on
      // the order somebody clicked.
      this.budgetSpent = true;
      return this.refuse(path, declaredBytes, "too-large");
    }

    const taken = await this.takeByFormat(member);
    if (taken.kind === "refused") return this.refuse(path, declaredBytes, taken.reason);

    this.budgetRemaining -= taken.bytes.byteLength;
    this.record.push({
      path,
      format: this.contents.format,
      outcome: "extracted",
      reason: null,
      declaredBytes,
      producedBytes: taken.bytes.byteLength,
    });
    return { kind: "ok", bytes: taken.bytes, member };
  }

  /**
   * Record a refusal the caller did not get from this module — the ingest gate refusing the member's
   * size or its kind, which happens after the bytes are out and is still a fact about the member.
   * The accounting is only complete if it holds those too.
   */
  recordExternalRefusal(path: string, reason: ArchiveExtractionRefusal): void {
    const declared = this.membersByPath.get(path)?.uncompressedSizeBytes ?? 0;
    this.record.push({
      path,
      format: this.contents.format,
      outcome: "refused",
      reason,
      declaredBytes: declared,
      producedBytes: 0,
    });
  }

  private refuse(
    path: string,
    declaredBytes: number,
    reason: ArchiveExtractionRefusal,
  ): ArchiveMemberExtraction {
    this.record.push({
      path,
      format: this.contents.format,
      outcome: "refused",
      reason,
      declaredBytes,
      producedBytes: 0,
    });
    return { kind: "refused", reason };
  }

  private async takeByFormat(
    member: ArchiveMember,
  ): Promise<{ kind: "ok"; bytes: Uint8Array } | { kind: "refused"; reason: ArchiveExtractionRefusal }> {
    const locator = member.locator;
    switch (locator.format) {
      case "zip":
        return extractZipMember(this.bucket, this.key, locator.entry, {
          maxUncompressedBytes: this.limits.maxUncompressedBytes,
          maxExpansionRatio: this.limits.maxExpansionRatio,
        });
      case "tar":
        return extractTarMember(this.bucket, this.key, locator.dataOffset, member.uncompressedSizeBytes);
      case "sevenZip": {
        const engine = this.engines.sevenZip;
        if (engine === undefined) return { kind: "refused", reason: "unsupported-compression" };
        // The listing already read whether this member's content is encrypted, so the refusal costs
        // nothing rather than a decode that was always going to fail.
        if (locator.encrypted) return { kind: "refused", reason: "encrypted" };
        return engine.extract(this.bucket, this.key, locator.memberIndex, {
          maxUncompressedBytes: this.limits.maxUncompressedBytes,
        });
      }
      case "rar":
        // Unreachable through a caller that asked `archiveExtractability` first, which is the
        // contract. Answered rather than thrown, because a surface that skipped that question should
        // refuse the member honestly instead of raising a fault at somebody's archive.
        return { kind: "refused", reason: "unsupported-compression" };
    }
  }
}

/**
 * Take one tar member's bytes: a ranged read and nothing else.
 *
 * A tar does not compress and keeps no checksum of a member's content — only of its header — so
 * there is no decoder to run and nothing to verify the bytes against beyond their length. That makes
 * this the cheapest extraction on the platform and also the one with the least to say: a short read
 * is the only way it can fail, and it means the object is not the archive its headers described.
 */
async function extractTarMember(
  bucket: ArchiveSourceBucket,
  key: string,
  dataOffset: number,
  sizeBytes: number,
): Promise<{ kind: "ok"; bytes: Uint8Array } | { kind: "refused"; reason: ArchiveExtractionRefusal }> {
  if (sizeBytes === 0) return { kind: "ok", bytes: new Uint8Array(0) };
  const head = await bucket.head(key);
  if (head === null) return { kind: "refused", reason: "archive-missing" };
  if (dataOffset < 0 || dataOffset + sizeBytes > head.size) {
    return { kind: "refused", reason: "malformed" };
  }
  const object = await bucket.get(key, { range: { offset: dataOffset, length: sizeBytes } });
  if (object === null) return { kind: "refused", reason: "archive-missing" };
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== sizeBytes) return { kind: "refused", reason: "malformed" };
  return { kind: "ok", bytes };
}
