/*
 * What the attachments tab is handed: the files already riding a record, and the documents the
 * matter holds that could ride it next.
 *
 * TWO SHAPES, NOT ONE, AND THE SPLIT IS THE POINT. An attachment is an ASSOCIATION — a record and a
 * document, joined — so it carries its own identity separately from the document's. That is what
 * lets ending the association leave the document exactly where it lives, and it is what lets the
 * picker answer "is this one already on the record?" without guessing from a name two documents
 * could share.
 */
import type { Instant } from "../../formatters/instant.ts";

/**
 * One file riding a record.
 *
 * The name arrives as the reader knows it, extension included: what a document is called is decided
 * where documents are named, and a tab that trimmed or re-spelled it would be a second opinion about
 * a fact that already has one.
 */
export interface RecordAttachment {
  /**
   * Stable identity for the ASSOCIATION — the render key, and what an act on this row names. It is
   * not the document's identity: the same document may be attached to more than one record, and
   * each of those is its own association that ends on its own.
   */
  identifier: string;
  /**
   * Which document this points at. It is what makes "already attached" answerable, so the picker can
   * leave out a document this record already carries.
   */
  documentIdentifier: string;
  /** The document's name, as it is named in the matter's files, extension included. */
  name: string;
  /** The document's media type where the server knows it. It picks the glyph beside the name. */
  contentType?: string;
  /** When it was attached. Rendered as an absolute instant in the reader's own local time. */
  attachedAt?: Instant;
  /** Who attached it: the person's name, never "You" and never an account identifier. */
  attachedBy?: string;
}

/** One document the matter holds, offered as something this record could point at. */
export interface AttachableDocument {
  /** The document's own identity. Matched against an attachment's `documentIdentifier`. */
  identifier: string;
  /** The document's name, as the matter's files name it. */
  name: string;
  /** The document's media type where it is known; it picks the glyph on the row. */
  contentType?: string;
}

/**
 * A folder of the matter's documents.
 *
 * The picker groups by folder because that is how the person who filed the document remembers where
 * it went. A document filed at the root belongs to a folder named for the root, so every document on
 * offer sits under a heading and none of them float.
 */
export interface AttachableDocumentFolder {
  /** Stable identity for the folder, used as the render key. */
  identifier: string;
  /** The folder's name as the reader sees it in the matter's files. */
  name: string;
  /** The documents filed directly in this folder. */
  documents: readonly AttachableDocument[];
}
