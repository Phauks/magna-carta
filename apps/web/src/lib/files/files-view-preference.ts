/*
 * The file surface's per-browser preferences — pure half (the codecs), so their normalize-on-read
 * rules are unit-testable without a DOM. The reactive stores are in the .svelte.ts beside this.
 *
 * Two preferences: which of the four views is active, and which optional regions are open. Both are
 * per-browser rather than per-matter — a member who works in tiles works in tiles everywhere, and
 * re-choosing the view on every matter would be the annoyance, not the convenience.
 */
// Relative, not `$lib`: this module is exercised by the node-environment unit tests, whose config
// carries no SvelteKit plugin and so resolves no `$lib` alias at runtime. A type-only `$lib` import
// would survive (it is erased), but these are real values.
import {
  jsonPreference,
  stringUnionPreference,
  type PreferenceCodec,
} from "../preferences/persisted-preference.ts";
import type { RegionVisibility } from "../view-shell/view-shell-types.ts";

/**
 * The ways the same files are presented. `list` is the dense sortable table, and the default.
 *
 * There is deliberately no chronological view: a timeline is an ORDER, not a presentation. The
 * surface sorts by created or modified date in ANY view (see ./file-sort.ts), which is the same
 * capability and more — a separate view could only have offered one hard-coded order.
 */
export const FILES_VIEWS = ["list", "tiles", "gallery"] as const;
export type FilesView = (typeof FILES_VIEWS)[number];

export const FILES_VIEW_STORAGE_KEY = "magna-carta:files:view";
export const FILES_REGIONS_STORAGE_KEY = "magna-carta:files:regions";

/** The id of the folder-tree region — the one optional region the collection surface offers today. */
export const FOLDERS_REGION_ID = "folders";

export const filesViewCodec: PreferenceCodec<FilesView> = stringUnionPreference<FilesView>(
  FILES_VIEW_STORAGE_KEY,
  FILES_VIEWS,
  "list",
);

/**
 * The regions record. Only known region ids survive a read, and only booleans — a stale id from a
 * retired region, or a hand-edited payload, is dropped rather than re-seating a region that no
 * longer exists. An absent id simply falls through to the region's own `defaultShown`.
 */
export const filesRegionsCodec: PreferenceCodec<RegionVisibility> =
  jsonPreference<RegionVisibility>(FILES_REGIONS_STORAGE_KEY, (parsed) => {
    const known = new Set<string>([FOLDERS_REGION_ID]);
    const record: RegionVisibility = {};
    if (parsed === null || typeof parsed !== "object") return record;
    for (const [id, shown] of Object.entries(parsed as Record<string, unknown>)) {
      if (known.has(id) && typeof shown === "boolean") record[id] = shown;
    }
    return record;
  });
