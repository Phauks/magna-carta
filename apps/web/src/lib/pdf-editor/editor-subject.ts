/*
 * What the PDF Editor is working on: a file on a matter, or a file on the File Workbench.
 *
 * The tools do the same work either way: read the bytes, draw the pages, hand the engine a copy,
 * and keep what it makes. Only the two ends differ, so the difference lives here and nowhere else.
 *
 * - A MATTER file is read from storage, and what the engine makes is added to the matter beside it,
 *   or saved as its next version.
 * - A BENCH file is read from the browser's own copy, and what the engine makes is put on the bench
 *   as a new file. A bench file has no versions and no matter, so nothing made from it is added to
 *   one: the member adds it to a matter later, if they choose to.
 *
 * Tools that cannot work without a matter (Bates takes its numbers from the matter's register, and
 * a signature request is sent from one) say so through `toolAvailability`, in one sentence, rather
 * than each tool refusing in its own words.
 */
import EyeOff from "@lucide/svelte/icons/eye-off";
import FileText from "@lucide/svelte/icons/file-text";
import Hash from "@lucide/svelte/icons/hash";
import Layers from "@lucide/svelte/icons/layers";
import Lock from "@lucide/svelte/icons/lock";
import Signature from "@lucide/svelte/icons/signature";
import Stamp from "@lucide/svelte/icons/stamp";
import type { Component } from "svelte";
import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";

/** A PDF on a matter. */
export interface MatterSubject {
  readonly kind: "matter";
  readonly name: string;
  readonly file: MatterFile;
}

/** A PDF on the File Workbench, which belongs to no matter. */
export interface BenchSubject {
  readonly kind: "bench";
  readonly name: string;
  readonly sizeBytes: number;
  /** The browser's own copy of the file. Rejects once the file has been taken off the bench. */
  readonly readBytes: () => Promise<Uint8Array>;
  /** Put a file the engine made on the bench, beside the original. */
  readonly putOnBench: (made: File) => void;
}

export type EditorSubject = MatterSubject | BenchSubject;

export function matterSubject(file: MatterFile): MatterSubject {
  return { kind: "matter", name: file.name, file };
}

export function benchSubject(
  file: {
    readonly name: string;
    readonly sizeBytes: number;
    readonly readBytes: () => Promise<Uint8Array>;
  },
  putOnBench: (made: File) => void,
): BenchSubject {
  return {
    kind: "bench",
    name: file.name,
    sizeBytes: file.sizeBytes,
    readBytes: file.readBytes,
    putOnBench,
  };
}

/** The matter this subject is on, or null for a bench file. */
export function matterOf(subject: EditorSubject): MatterFile | null {
  return subject.kind === "matter" ? subject.file : null;
}

/**
 * Whether saving changes this file's own next version. Only a matter file has versions: the same
 * save on a bench file puts a changed copy beside it, and the button says which it does.
 */
export function savesVersions(subject: EditorSubject): boolean {
  return subject.kind === "matter";
}

/**
 * The name a changed copy of a bench file takes, where a matter file would have taken a version:
 * `Lease.pdf` arranged becomes `Lease (Arranged).pdf`. The original keeps its own name, so the two
 * are told apart on the bench.
 */
export function changedCopyName(originalName: string, change: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  const stem = hasExtension ? originalName.slice(0, dot) : originalName;
  const extension = hasExtension ? originalName.slice(dot) : ".pdf";
  return `${stem} (${change})${extension}`;
}

/** Put what the engine made on the bench. Returns the name it went on under. */
export function putMadeOnBench(subject: BenchSubject, bytes: Uint8Array, name: string): string {
  subject.putOnBench(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return name;
}

/** The PDF Editor's tools, in the order its tab strip lists them. */
export type EditorToolId =
  | "pages"
  | "redact"
  | "forms"
  | "bates"
  | "watermark"
  | "secure"
  | "signature";

export interface EditorTool {
  readonly id: EditorToolId;
  /** Tab label, and the name the File Workbench lists the tool under. */
  readonly label: string;
  readonly icon: Component;
  /** One line saying what the tool does, as the File Workbench lists it. */
  readonly description: string;
}

export const EDITOR_TOOLS: readonly EditorTool[] = [
  {
    id: "pages",
    label: "Pages",
    icon: Layers,
    description: "Reorder, rotate, delete, insert, extract, split",
  },
  { id: "redact", label: "Redact", icon: EyeOff, description: "Remove text and areas for good" },
  { id: "forms", label: "Forms", icon: FileText, description: "Fill the fields, or flatten them" },
  { id: "bates", label: "Bates", icon: Hash, description: "Number every page" },
  {
    id: "watermark",
    label: "Watermark",
    icon: Stamp,
    description: "Words or an image across the pages",
  },
  { id: "secure", label: "Secure", icon: Lock, description: "Add a password and limits" },
  { id: "signature", label: "Signature", icon: Signature, description: "Send it to be signed" },
];

export function editorToolById(id: string | null): EditorTool | null {
  return EDITOR_TOOLS.find((tool) => tool.id === id) ?? null;
}

/**
 * The tools offered for a subject. Signature is left off a bench file entirely: a signature request
 * is a record on a matter, sent to people on it, and there is nothing of it a bench file could use.
 * Bates stays listed and says why it is shut, because numbering a file is something a member does
 * ask of a loose PDF, and the answer (add it to a matter) is worth seeing.
 */
export function editorToolsFor(kind: EditorSubject["kind"]): readonly EditorTool[] {
  return kind === "matter" ? EDITOR_TOOLS : EDITOR_TOOLS.filter((tool) => tool.id !== "signature");
}

export type ToolAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/** Whether a tool can work on this kind of subject, and the one-line reason when it cannot. */
export function toolAvailability(
  tool: EditorToolId,
  kind: EditorSubject["kind"],
): ToolAvailability {
  if (kind === "matter") return { available: true };
  if (tool === "bates") {
    return {
      available: false,
      reason: "Needs a matter's Bates register.",
    };
  }
  if (tool === "signature") {
    return { available: false, reason: "Needs a matter: a signature request is sent from one." };
  }
  return { available: true };
}
