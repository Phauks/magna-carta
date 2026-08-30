/*
 * FileIcon resolution — the Lucide glyph each file kind draws, and the whole presentation the
 * component renders (glyph, tone, badge) resolved in one call so the three can never disagree.
 * The vocabulary itself — what kind a file is, its tone, its badge text — lives in file-types.ts,
 * which holds no component references and is therefore checkable without rendering anything.
 *
 * Icon choices are deliberately calm and uniform in weight (the file list is a work surface — the
 * type glyph informs, it does not shout).
 *
 * The pdf glyph is the EMPTY sheet (`file`), not `file-text` and not `file-type`: `file-type` draws
 * a letter T, which reads as a typography file rather than a pdf, and `file-text`'s ruled lines
 * fight the badge that sits over them. The empty sheet leaves the badge the room it needs, and the
 * badge is what says "pdf".
 */
import File from "@lucide/svelte/icons/file";
import FileText from "@lucide/svelte/icons/file-text";
import FileSpreadsheet from "@lucide/svelte/icons/file-spreadsheet";
import Presentation from "@lucide/svelte/icons/presentation";
import FileImage from "@lucide/svelte/icons/file-image";
import FileVideo2 from "@lucide/svelte/icons/file-video-2";
import FileAudio2 from "@lucide/svelte/icons/file-audio-2";
import FileArchive from "@lucide/svelte/icons/file-archive";
import FileCode from "@lucide/svelte/icons/file-code";
import FileCog from "@lucide/svelte/icons/file-cog";
import Mail from "@lucide/svelte/icons/mail";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import {
  resolveFileCategory,
  resolveFileIconTone,
  resolveFileTypeBadge,
  type FileCategory,
  type FileIconTone,
  type FileTypeBadge,
} from "./file-types.ts";

/** A Lucide icon component, as imported from `@lucide/svelte/icons/*`. */
export type FileIconComponent = typeof File;

/** Everything the component needs to draw one file: the glyph, its tone, and its badge if any. */
export interface FileIconPresentation {
  readonly icon: FileIconComponent;
  readonly tone: FileIconTone;
  readonly badge?: FileTypeBadge;
}

/** One glyph per category — the single source of truth for what each kind looks like. */
const CATEGORY_ICON: Record<FileCategory, FileIconComponent> = {
  pdf: File,
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  image: FileImage,
  video: FileVideo2,
  audio: FileAudio2,
  archive: FileArchive,
  text: FileText,
  code: FileCode,
  email: Mail,
  program: FileCog,
  unknown: File,
};

/** What every resolver here accepts: a file's identity, or an explicit override. */
export interface FileIconInput {
  contentType?: string;
  fileName?: string;
  category?: FileCategory;
  folder?: boolean;
  open?: boolean;
}

/**
 * Resolve the Lucide glyph for a file or folder. `folder` wins first (a folder row draws a folder,
 * open or closed); then an explicit `category` override; then the derived category.
 */
export function resolveFileIcon(input: FileIconInput): FileIconComponent {
  if (input.folder) return input.open ? FolderOpen : Folder;
  const category = input.category ?? resolveFileCategory(input);
  return CATEGORY_ICON[category];
}

/**
 * Everything one file's icon needs, resolved together: the glyph, the tone it is drawn in, and the
 * badge that rides it. A folder is a folder — no tone, no badge.
 */
export function resolveFileIconPresentation(input: FileIconInput): FileIconPresentation {
  if (input.folder) {
    return { icon: input.open ? FolderOpen : Folder, tone: "default" };
  }
  const category = input.category ?? resolveFileCategory(input);
  const badge = resolveFileTypeBadge({ ...input, category });
  return {
    icon: CATEGORY_ICON[category],
    tone: resolveFileIconTone(category),
    ...(badge === undefined ? {} : { badge }),
  };
}
