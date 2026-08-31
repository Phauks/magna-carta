/*
 * What one file's own menu offers.
 *
 * A pure list, so which verbs a row carries and when each is refused can be asserted without
 * rendering anything. The rail draws it; this decides it.
 *
 * The verbs are the ones an UNFILED file has. A matter's file menu is a much longer list — pin,
 * rename, document type, cut and paste, restore — and every one of those acts on a record inside a
 * folder. Nothing here is filed, so offering them would be offering verbs with nowhere to land.
 * What is left is: look at it with a particular capability, take a copy of what was read, and throw
 * it away.
 */
import type { Component } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { BrowserDigests } from "./digest.ts";
import { HASH_CAPABILITY } from "./capabilities/hash.ts";
import { outcomeFor, type WorkbenchFile } from "./workbench-file.ts";

export interface RowMenuItem {
  /** Stable identity; the rail switches on it. */
  readonly identifier: "copy-name" | "copy-digest" | "download" | "discard";
  readonly label: string;
  readonly icon: Component;
  /** Why this verb cannot be taken on this file. Absent when it can. */
  readonly disabledReason?: string;
}

/** The verbs for one file, in reading order, with the refusals already decided. */
export function rowMenuItems(file: WorkbenchFile): readonly RowMenuItem[] {
  const digest = outcomeFor<BrowserDigests>(file, HASH_CAPABILITY);
  return [
    { identifier: "copy-name", label: "Copy Name", icon: Copy },
    {
      identifier: "copy-digest",
      label: "Copy SHA-256",
      icon: Fingerprint,
      // A digest that has not been computed cannot be copied, and the reason is worth saying: on a
      // large file it is the server's to compute, not this browser's.
      disabledReason:
        digest.kind === "result"
          ? undefined
          : digest.kind === "not-applicable"
            ? digest.reason
            : "This file has not been read yet.",
    },
    {
      identifier: "download",
      label: "Download",
      icon: Download,
      disabledReason: "Nothing has been produced from this file to download yet.",
    },
    { identifier: "discard", label: "Discard", icon: Trash2 },
  ];
}

/** The text a copy verb puts on the clipboard, or null where there is nothing to copy. */
export function clipboardTextFor(item: RowMenuItem, file: WorkbenchFile): string | null {
  if (item.identifier === "copy-name") return file.name;
  if (item.identifier === "copy-digest") {
    const digest = outcomeFor<BrowserDigests>(file, HASH_CAPABILITY);
    return digest.kind === "result" ? digest.value["SHA-256"] : null;
  }
  return null;
}
