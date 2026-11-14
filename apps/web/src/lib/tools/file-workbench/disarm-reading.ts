/*
 * What the Malware Scan tab says about a disarm: the plain name of each sort of thing the engine
 * took out, and what the disarmed copy is called.
 *
 * The engine (`@magna-carta/disarm`) reports removals by a stable code. The words for each live here
 * and nowhere else, so the table and anything that later reads the same report say the same thing.
 */
import type { DisarmableKind, Removal, RemovalKind } from "@magna-carta/disarm";

const REMOVAL_NAMES: Readonly<Record<RemovalKind, string>> = {
  script: "Scripts and macros",
  automaticAction: "Actions that run when the file opens",
  externalAction: "Actions that start a program, send a form or open another file",
  embeddedFile: "Files carried inside",
  embeddedObject: "Embedded objects",
  control: "ActiveX and other controls",
  dynamicForm: "Dynamic forms",
  activeContent: "Multimedia and 3D content",
  externalLink: "Links fetched without asking",
  dynamicField: "Fields and formulas that run commands",
  customInterface: "Custom ribbons",
  pictureMetadata: "Picture metadata",
  animationFlattened: "Animation, kept as its first frame",
};

export interface RemovalRow {
  readonly kind: RemovalKind;
  readonly name: string;
  readonly count: number;
}

export function removalRows(removals: readonly Removal[]): RemovalRow[] {
  return removals.map((removal) => ({
    kind: removal.kind,
    name: REMOVAL_NAMES[removal.kind] ?? removal.kind,
    count: removal.count,
  }));
}

const KIND_NAMES: Readonly<Record<DisarmableKind, string>> = {
  pdf: "PDF",
  officePackage: "Office document",
  rtf: "RTF document",
  jpeg: "JPEG picture",
  png: "PNG picture",
  gif: "GIF picture",
  tiff: "TIFF picture",
  bmp: "BMP picture",
  webp: "WebP picture",
};

export function disarmableKindName(kind: DisarmableKind): string {
  return KIND_NAMES[kind];
}

/**
 * "Engagement Letter.docm" becomes "Engagement Letter (disarmed).docx" when the engine says the copy
 * is now a different kind of file, and keeps its extension otherwise.
 */
export function disarmedCopyName(name: string, outputExtension: string | null): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = outputExtension ?? (dot <= 0 ? null : name.slice(dot + 1));
  return extension === null ? `${stem} (disarmed)` : `${stem} (disarmed).${extension}`;
}
