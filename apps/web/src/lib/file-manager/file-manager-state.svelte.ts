/*
 * The file manager's state — one object the whole surface reads and writes, so the rail, the
 * toolbar, the table, the footer and the details panel can never disagree about where the reader
 * is standing or what they have selected.
 *
 * Everything a reader chooses about how the surface looks — extensions shown or hidden, the sidebar
 * counts, list or icons, the scale, whether the details panel is open — persists per browser, so
 * coming back to a matter is coming back to the surface you left. The panel's open state especially:
 * selecting a row NEVER opens a closed panel, so if closing it did not stick, every visit would
 * reopen the thing the reader had deliberately shut.
 */
import {
  createPersistedPreference,
  type PersistedPreference,
} from "$lib/preferences/persisted-preference.svelte.ts";
import { stringUnionPreference } from "$lib/preferences/persisted-preference.ts";
import { NavigationHistory, type NavigationPlace } from "./navigation-history.ts";
import { MoveHistory } from "./move-history.ts";

/** The scale steps the slider snaps to, from half size to double. */
export const SCALE_STEPS = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 175, 200] as const;

/** The views this surface offers. Four of them are not places in the folder tree. */
export const FILE_MANAGER_VIEWS = ["browse", "analysis", "deleted", "results", "history"] as const;
export type FileManagerView = (typeof FILE_MANAGER_VIEWS)[number];

/** Which of the two ways the files are laid out. */
export type ListMode = "list" | "icons";

/** What is waiting on a paste, and whether pasting will move it or duplicate it. */
export interface Clipboard {
  readonly keys: readonly string[];
  readonly mode: "copy" | "cut";
}

/** The details panel's five tabs for a file. Preview is separate from Details, deliberately. */
export const INSPECTOR_TABS = ["preview", "details", "versions", "hashes", "safety"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

const openClosed = (key: string, fallback: "open" | "closed") =>
  stringUnionPreference(key, ["open", "closed"] as const, fallback);

const shownHidden = (key: string, fallback: "shown" | "hidden") =>
  stringUnionPreference(key, ["shown", "hidden"] as const, fallback);

export class FileManagerState {
  // --- where the reader is standing -----------------------------------------------------------

  view = $state<FileManagerView>("browse");
  currentFolderId = $state<string | null>(null);
  /** Which folders in the rail are open. */
  expandedFolderIds = $state<string[]>([]);

  private readonly navigation = new NavigationHistory({ view: "browse", folderId: null });
  /** Bumped whenever the navigation stack changes, so the controls re-derive their own state. */
  private navigationRevision = $state(0);

  // --- what is selected, and what the panel is describing --------------------------------------

  /** The row keys the reader has selected, mirrored out of the grid's own selection model. */
  selectedKeys = $state<readonly string[]>([]);
  /** What the details panel describes: the last row selected, never a second selection model. */
  inspectorKey = $state<string | null>(null);
  inspectorTab = $state<InspectorTab>("details");
  /** The row whose name is being edited in place, or null. */
  renamingKey = $state<string | null>(null);

  // --- acts in flight ---------------------------------------------------------------------------

  clipboard = $state<Clipboard | null>(null);
  /** Pinned row keys, in the reader's own arranged order. Pinning is arranging, not sorting. */
  pinnedKeys = $state<string[]>([]);
  readonly moves = new MoveHistory();
  /** Bumped whenever a move is recorded or reversed, so the undo controls re-derive. */
  moveRevision = $state(0);

  // --- search ------------------------------------------------------------------------------------

  searchQuery = $state("");
  /** The scope names the matter and no wider: application-wide search is the top bar's job. */
  searchScope = $state<"matter" | "files" | "folder">("matter");
  searchIncludesDeleted = $state(false);

  // --- the reader's own settings ------------------------------------------------------------------

  private readonly extensionsPreference: PersistedPreference<"shown" | "hidden">;
  private readonly sidebarCountsPreference: PersistedPreference<"shown" | "hidden">;
  private readonly listModePreference: PersistedPreference<ListMode>;
  private readonly panelPreference: PersistedPreference<"open" | "closed">;
  private readonly railPreference: PersistedPreference<"open" | "closed">;
  private readonly scalePreference: PersistedPreference<string>;

  constructor() {
    this.extensionsPreference = createPersistedPreference(
      shownHidden("magna-carta-file-manager-extensions", "shown"),
    );
    this.sidebarCountsPreference = createPersistedPreference(
      shownHidden("magna-carta-file-manager-sidebar-counts", "shown"),
    );
    this.listModePreference = createPersistedPreference(
      stringUnionPreference("magna-carta-file-manager-layout", ["list", "icons"] as const, "list"),
    );
    this.panelPreference = createPersistedPreference(
      openClosed("magna-carta-file-manager-details", "open"),
    );
    this.railPreference = createPersistedPreference(
      openClosed("magna-carta-file-manager-tree", "open"),
    );
    this.scalePreference = createPersistedPreference(
      stringUnionPreference(
        "magna-carta-file-manager-scale",
        SCALE_STEPS.map((step) => String(step)),
        "100",
      ),
    );
  }

  get hideExtensions(): boolean {
    return this.extensionsPreference.current === "hidden";
  }

  setHideExtensions(hide: boolean): void {
    this.extensionsPreference.set(hide ? "hidden" : "shown");
  }

  get showSidebarCounts(): boolean {
    return this.sidebarCountsPreference.current === "shown";
  }

  setShowSidebarCounts(show: boolean): void {
    this.sidebarCountsPreference.set(show ? "shown" : "hidden");
  }

  get listMode(): ListMode {
    return this.listModePreference.current;
  }

  setListMode(mode: ListMode): void {
    this.listModePreference.set(mode);
  }

  get panelOpen(): boolean {
    return this.panelPreference.current === "open";
  }

  setPanelOpen(open: boolean): void {
    this.panelPreference.set(open ? "open" : "closed");
  }

  get railOpen(): boolean {
    return this.railPreference.current === "open";
  }

  setRailOpen(open: boolean): void {
    this.railPreference.set(open ? "open" : "closed");
  }

  /** The file area's scale, as a percentage. It scales previews, row height and the area's text. */
  get scalePercent(): number {
    return Number(this.scalePreference.current);
  }

  setScalePercent(percent: number): void {
    const nearest = SCALE_STEPS.reduce((best, step) =>
      Math.abs(step - percent) < Math.abs(best - percent) ? step : best,
    );
    this.scalePreference.set(String(nearest));
  }

  // --- navigating ----------------------------------------------------------------------------

  get place(): NavigationPlace {
    void this.navigationRevision;
    return this.navigation.place;
  }

  get canGoBack(): boolean {
    void this.navigationRevision;
    return this.navigation.canGoBack;
  }

  get canGoForward(): boolean {
    void this.navigationRevision;
    return this.navigation.canGoForward;
  }

  /** Up is only a place while browsing: no other view sits inside a folder. */
  get canGoUp(): boolean {
    return this.view === "browse" && this.currentFolderId !== null;
  }

  private land(place: NavigationPlace): void {
    this.view = place.view as FileManagerView;
    this.currentFolderId = place.folderId;
    this.navigationRevision += 1;
    // The rows the old place named are not on screen any more, and an act on rows the reader can
    // no longer see is the worst kind of surprise.
    this.selectedKeys = [];
    this.renamingKey = null;
  }

  openFolder(folderId: string | null): void {
    this.navigation.go({ view: "browse", folderId });
    this.land(this.navigation.place);
  }

  openView(view: FileManagerView, folderId: string | null = null): void {
    this.navigation.go({ view, folderId });
    this.land(this.navigation.place);
  }

  goBack(): void {
    this.land(this.navigation.back());
  }

  goForward(): void {
    this.land(this.navigation.goForward());
  }

  goUp(parentFolderId: string | null): void {
    if (!this.canGoUp) return;
    this.openFolder(parentFolderId);
  }

  /** Drop remembered places naming folders that are gone, so Back cannot strand the reader. */
  forgetMissingFolders(missing: ReadonlySet<string>): void {
    this.navigation.forget(missing);
    this.navigationRevision += 1;
  }

  // --- pinning -------------------------------------------------------------------------------

  isPinned(key: string): boolean {
    return this.pinnedKeys.includes(key);
  }

  togglePinned(key: string): void {
    this.pinnedKeys = this.isPinned(key)
      ? this.pinnedKeys.filter((pinned) => pinned !== key)
      : [...this.pinnedKeys, key];
  }

  setPinned(keys: readonly string[], pinned: boolean): void {
    if (pinned) {
      const already = new Set(this.pinnedKeys);
      this.pinnedKeys = [...this.pinnedKeys, ...keys.filter((key) => !already.has(key))];
      return;
    }
    const dropping = new Set(keys);
    this.pinnedKeys = this.pinnedKeys.filter((key) => !dropping.has(key));
  }

  // --- the clipboard ---------------------------------------------------------------------------

  mark(keys: readonly string[], mode: "copy" | "cut"): void {
    this.clipboard = keys.length === 0 ? null : { keys: [...keys], mode };
  }

  clearClipboard(): void {
    this.clipboard = null;
  }

  clipboardMarkOf(key: string): "cut" | "copy" | undefined {
    return this.clipboard?.keys.includes(key) === true ? this.clipboard.mode : undefined;
  }
}
