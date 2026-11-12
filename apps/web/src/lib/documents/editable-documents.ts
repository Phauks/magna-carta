/*
 * Which documents can be worked on in the browser, and where "Open" takes each one.
 *
 * ONE "OPEN" (the file manager's standing ruling): double-click, Enter and the menu's Open are one
 * gesture, and what it does is decided by what the file IS rather than by a second menu item. A
 * word-processing document opens its editor; a plain-text document opens its editor; an archive
 * opens into itself; everything else opens its preview, and a flagged file previews the
 * withholding rather than opening anything. This module is the one place that decision is made,
 * so the list, the icon grid and the menu cannot drift apart about it.
 *
 * Two editors, because the two kinds of document have different homes. An office format is edited
 * by the browser editor the edit worker serves (the document never leaves object storage; the
 * editor reads and saves it through the host's own callback surface). A plain-text document is
 * edited here, in the application itself: its bytes are small, its format is its content, and a
 * new version is cut through the same upload ceremony any other save uses.
 *
 * WHICH FORMATS TAKE WHICH WAY IS THE REGISTER'S FACT, NOT THIS MODULE'S. file-type-register.ts
 * holds every family and the way it opens, and Settings · Opening Files renders that same register;
 * this module only applies it to a file. The content type the ingest gate sniffed wins over the
 * name where it is present — the OPPOSITE of the file icon's precedence, on purpose: the icon draws
 * what the name claims and leaves the file manager's analysis to say whether the claim holds, but
 * an editor is handed the bytes, and a Word document renamed ".txt" must open as the Word document
 * it is, never in the plain-text editor its name asks for. The name's extension decides where the
 * gate sniffed nothing it could place, which is how a legacy office format the gate has no
 * signature for still reaches the editor that opens it.
 */
import { resolveFileContentCategory, extensionOf } from "@magna-carta/design-system/file-icon";
import { officeEditorOpens, openMethodOfCategory, type OpenMethod } from "./file-type-register.ts";

/** The editor a document opens in. */
export type EditorKind = "office" | "text";

/** The facts about a file the decision reads. Every file surface already carries them. */
export interface EditableFileFacts {
  readonly name: string;
  readonly sniffedContentType: string | null;
  readonly currentVersionId: string | null;
  readonly status: "clean" | "pending" | "quarantined";
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
}

/**
 * The most a plain-text document may weigh to be edited here. The editor holds the whole text in
 * one field, so this is a ceiling on what a browser tab is asked to carry, not a limit of the
 * storage; a document past it is still downloadable and still versioned by upload.
 */
export const TEXT_EDITOR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The editor a file's FORMAT calls for, or null where the format has no editor. Answered from the
 * format alone: whether the file can be opened right now is a separate question (`openDestinationOf`).
 * The precedence between the sniffed bytes and the name is stated at the top of this module.
 */
export function editorKindOf(
  file: Pick<EditableFileFacts, "name" | "sniffedContentType">,
): EditorKind | null {
  const method = openMethodOf(file);
  if (method === "office-editor") return "office";
  if (method === "text-editor") return "text";
  return null;
}

/**
 * The way a file's FORMAT opens, from the register. The sniffed content type places the file in a
 * category first; where it places it nowhere, the name's extension is asked whether the browser
 * editor takes it. A file the register has no answer for opens the preview, which says so.
 */
export function openMethodOf(
  file: Pick<EditableFileFacts, "name" | "sniffedContentType">,
): OpenMethod {
  const category = resolveFileContentCategory({
    contentType: file.sniffedContentType ?? undefined,
    fileName: file.name,
  });
  const byCategory = openMethodOfCategory(category);
  if (byCategory !== null) return byCategory;
  return officeEditorOpens(extensionOf(file.name)) ? "office-editor" : "preview";
}

/**
 * The readers a file can open in: the page reader, and the player for a recording with a picture or
 * with sound alone. Both recordings open on the same player page, which draws sound alone as a
 * panel of controls.
 */
export type ViewerKind = "pdf" | "video" | "audio";

/**
 * The reader a file's FORMAT calls for where the file can be READ but not written, or null where
 * the format has no reader. A portable document opens in the reader the firm's own engine draws,
 * and a recording opens in the player. Whether this browser can actually decode a particular
 * recording is not decided here: the player page asks the server, which has read the file's track
 * table, and offers the download where the answer is no.
 */
export function viewerKindOf(
  file: Pick<EditableFileFacts, "name" | "sniffedContentType">,
): ViewerKind | null {
  const category = resolveFileContentCategory({
    contentType: file.sniffedContentType ?? undefined,
    fileName: file.name,
  });
  if (category === "pdf") return "pdf";
  if (category === "video") return "video";
  if (category === "audio") return "audio";
  return null;
}

/** Where a file's editor lives. One address per document, opened beside the reader's work. */
export function editorHref(fileId: string): string {
  return `/documents/${encodeURIComponent(fileId)}/edit`;
}

/**
 * Where a file's reader lives. A separate address from the editor's, because the two are different
 * promises: one invites a change and the other cannot take one, and an address that says `edit`
 * over a document nobody can edit is a lie the reader finds out by trying.
 */
export function viewerHref(fileId: string, viewer: ViewerKind = "pdf"): string {
  const segment = viewer === "pdf" ? "view" : "watch";
  return `/documents/${encodeURIComponent(fileId)}/${segment}`;
}

/** What the one Open gesture does for a file. */
export type OpenDestination =
  /** Open the editor, beside the reader's work. */
  | { readonly kind: "editor"; readonly editor: EditorKind; readonly href: string }
  /** Open the read-only viewer, beside the reader's work. */
  | { readonly kind: "viewer"; readonly viewer: ViewerKind; readonly href: string }
  /** Open the preview panel — which, for a file with nothing to show, says why. */
  | { readonly kind: "preview" };

/**
 * A file opens its editor only when it has committed, clean bytes and nothing is holding them
 * back. A file still being checked, one the gate refused, and one a re-scan flagged all open the
 * preview instead, where the panel states what is being withheld and why; a blank editor over a
 * file the platform will not serve is the worse answer.
 */
export function openDestinationOf(
  file: EditableFileFacts & { readonly id: string },
): OpenDestination {
  const editor = editorKindOf(file);
  const viewer = viewerKindOf(file);
  if (editor === null && viewer === null) return { kind: "preview" };
  if (file.currentVersionId === null || file.status !== "clean") return { kind: "preview" };
  if (file.scanVerdict === "flagged") return { kind: "preview" };
  if (editor !== null) return { kind: "editor", editor, href: editorHref(file.id) };
  if (viewer === null) return { kind: "preview" };
  return { kind: "viewer", viewer, href: viewerHref(file.id, viewer) };
}

/**
 * The content type a plain-text save declares. The gate sniffs magic bytes and plain text has
 * none, so the declaration is what the stored version carries; it follows the name, because the
 * name is what the reader chose the format by.
 */
export function textContentTypeOf(fileName: string): string {
  switch (extensionOf(fileName)) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "html":
    case "htm":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return "text/javascript";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "yml":
    case "yaml":
      return "application/x-yaml";
    default:
      return "text/plain";
  }
}
