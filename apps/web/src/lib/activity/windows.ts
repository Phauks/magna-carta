/*
 * The record windows the Activity register can host, by the key a contribution names.
 *
 * KEPT APART FROM contributions.ts ON PURPOSE. The contribution registry is DOM-free so the fitness
 * test can pair it to the server's registry without a browser; a window is a Svelte component, so
 * the windows live here, mapped separately — the file workbench's registry-and-panels precedent.
 * A subsystem with a window adds one line here and names the key from its contribution's `open`
 * and `create`; the register mounts whichever key a row or a verb names and never names one itself.
 */
import type { Component } from "svelte";
import type { ActivityWindowProps } from "./contribution.ts";
import type { ActivityWindowKey } from "./window-keys.ts";
import NoteWindowHost from "$lib/matters/note-window-host.svelte";

export const ACTIVITY_WINDOWS: Readonly<Record<ActivityWindowKey, Component<ActivityWindowProps>>> =
  {
    note: NoteWindowHost,
  };
