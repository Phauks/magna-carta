/*
 * How this person likes the workbench laid out, remembered between visits.
 *
 * Two choices, and both are about where the reader wants their attention. Whether the file is drawn
 * beside its readings is a judgement about this file and this job — a scan wants looking at, a long
 * conversion list wants the width — and which SIDE it sits on is a habit, not a judgement: somebody
 * who reads left-to-right from the document may want it leading, and somebody working the readings
 * may want them nearest the list. Neither is the product's call, so neither is hard-coded.
 *
 * Both hold across capability tabs. Switching from Hash to Metadata is not a reason to rearrange
 * somebody's screen.
 */
import { createPersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";

export type PreviewVisibility = "shown" | "hidden";
/** Which side of the readings the file is drawn on. */
export type PreviewSide = "left" | "right";

export class WorkbenchPreferences {
  readonly visibility = createPersistedPreference(
    stringUnionPreference(
      "magna-carta-file-workbench-preview",
      ["shown", "hidden"] as const,
      "shown",
    ),
  );

  readonly side = createPersistedPreference(
    stringUnionPreference(
      "magna-carta-file-workbench-preview-side",
      ["left", "right"] as const,
      // The file leads by default: the first question this bench answers is what the thing IS, and
      // the readings are the annotation on it.
      "left",
    ),
  );

  get previewShown(): boolean {
    return this.visibility.current === "shown";
  }

  get previewSide(): PreviewSide {
    return this.side.current;
  }

  togglePreview(): void {
    this.visibility.set(this.previewShown ? "hidden" : "shown");
  }

  swapSide(): void {
    this.side.set(this.previewSide === "left" ? "right" : "left");
  }
}
