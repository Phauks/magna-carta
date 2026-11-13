/*
 * THE MEMBER'S SHELF: their folders, what they have pinned, and the rows of each folder.
 *
 * The owner's ruling for the rail (docs/conventions/magnus-rulings.md, R2.12): sections that fold,
 * with Pinned first and its items duplicated rather than moved, then the member's folders, then
 * General. Each section is its OWN read of the server's listing, filtered to that section and in the
 * order the reader chose, because the rail's order is the server's (R1): grouping the rows of one
 * paged list into sections would sort a page, and a folder whose conversations were two pages down
 * would read as empty. General is the surface's own list, read with the General filter, so it keeps
 * the arrival behaviour it already had; this class holds the rest.
 *
 * A folder's rows are read when its section is first opened and not before, so a member with forty
 * folders pays for the ones they look at.
 */
import { SvelteMap } from "svelte/reactivity";
import type { ApiOutcome, Failure } from "$lib/api/request.ts";
import { PagedList, type PageReader } from "$lib/matters/paged-list.svelte.ts";
import {
  createFolder,
  deleteFolder,
  listFolders,
  newWriteKey,
  renameFolder,
  shelveConversation,
  type MagnusConversation,
  type MagnusFolder,
  type MagnusShelf,
} from "./magnus-api.ts";

/** The section names that are not folders. A folder's section is named by its id. */
export const PINNED_SECTION = "pinned";
export const GENERAL_SECTION = "general";

/** What a section's read is narrowed to. */
export type ShelfFilter = { folder: string } | { pinned: true };

export class ConversationShelf {
  /** Null until the first read lands. */
  folders = $state<readonly MagnusFolder[] | null>(null);
  folderFailure = $state<Failure | null>(null);
  /** The sections the reader has open. Pinned and General start open; folders start folded. */
  openSections = $state<string[]>([PINNED_SECTION, GENERAL_SECTION]);
  readonly pinned = new PagedList<MagnusConversation>(
    "Your pinned conversations could not be read.",
  );
  readonly #lists = new SvelteMap<string, PagedList<MagnusConversation>>();
  readonly #fetch: typeof fetch;
  readonly #reader: (filter: ShelfFilter) => PageReader<MagnusConversation>;
  #subject = "";

  constructor(
    fetchImpl: typeof fetch,
    reader: (filter: ShelfFilter) => PageReader<MagnusConversation>,
  ) {
    this.#fetch = fetchImpl;
    this.#reader = reader;
  }

  /** The rows of one folder's section, made on first use. */
  listFor(folderId: string): PagedList<MagnusConversation> {
    const existing = this.#lists.get(folderId);
    if (existing !== undefined) return existing;
    const made = new PagedList<MagnusConversation>(
      "This folder's conversations could not be read.",
    );
    made.reset(`${this.#subject}:${folderId}`);
    this.#lists.set(folderId, made);
    return made;
  }

  /** A conversation as one of the shelf's own sections last read it, wherever it sits. */
  find(conversationId: string): MagnusConversation | undefined {
    const pinned = this.pinned.items?.find((row) => row.id === conversationId);
    if (pinned !== undefined) return pinned;
    for (const list of this.#lists.values()) {
      const found = list.items?.find((row) => row.id === conversationId);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /**
   * Reads everything the shelf shows again: the folders, Pinned, and every folder section that is
   * open. A section that is folded is forgotten, and read again when it is next opened. `subject`
   * names what the rows belong to (the screen, the order), so a page that lands after a change of
   * order is discarded rather than drawn under the new one.
   */
  async reload(subject: string): Promise<void> {
    this.#subject = subject;
    this.pinned.reset(`${subject}:${PINNED_SECTION}`);
    for (const [folderId, list] of this.#lists) list.reset(`${subject}:${folderId}`);
    const reads: Promise<void>[] = [
      this.#readFolders(),
      this.pinned.load(this.#reader({ pinned: true })),
    ];
    for (const section of this.openSections) {
      if (section !== PINNED_SECTION && section !== GENERAL_SECTION) {
        reads.push(this.listFor(section).load(this.#reader({ folder: section })));
      }
    }
    await Promise.all(reads);
  }

  /** The reader opened or folded sections. A folder opened for the first time is read now. */
  setOpen(sections: string[]): void {
    const newlyOpen = sections.filter((section) => !this.openSections.includes(section));
    this.openSections = sections;
    for (const section of newlyOpen) {
      if (section === PINNED_SECTION || section === GENERAL_SECTION) continue;
      const list = this.listFor(section);
      if (list.items === null) void list.load(this.#reader({ folder: section }));
    }
  }

  loadMore(section: string): Promise<void> {
    if (section === PINNED_SECTION) return this.pinned.loadMore(this.#reader({ pinned: true }));
    return this.listFor(section).loadMore(this.#reader({ folder: section }));
  }

  async #readFolders(): Promise<void> {
    const outcome = await listFolders(this.#fetch);
    if (outcome.kind !== "ok") {
      this.folderFailure = outcome.failure;
      return;
    }
    this.folderFailure = null;
    this.folders = outcome.value.data;
  }

  /** Makes a folder and opens its section, so the reader sees where it went. */
  async create(name: string): Promise<ApiOutcome<MagnusFolder>> {
    const outcome = await createFolder(this.#fetch, name, newWriteKey());
    if (outcome.kind === "ok") {
      await this.#readFolders();
      this.setOpen([...this.openSections, outcome.value.id]);
    }
    return outcome;
  }

  async rename(folderId: string, name: string): Promise<ApiOutcome<MagnusFolder>> {
    const outcome = await renameFolder(this.#fetch, folderId, name, newWriteKey());
    if (outcome.kind === "ok") await this.#readFolders();
    return outcome;
  }

  /** Removes a folder. The caller reads General again, which is where its conversations went. */
  async remove(folderId: string): Promise<ApiOutcome<{ id: string }>> {
    const outcome = await deleteFolder(this.#fetch, folderId, newWriteKey());
    if (outcome.kind === "ok") {
      this.#lists.delete(folderId);
      this.openSections = this.openSections.filter((section) => section !== folderId);
      await this.#readFolders();
    }
    return outcome;
  }

  /** Moves or pins a conversation. The caller reads the shelf and General again afterwards. */
  shelve(
    conversationId: string,
    shelf: { folderId: string | null; pinned: boolean },
  ): Promise<ApiOutcome<MagnusShelf>> {
    return shelveConversation(this.#fetch, conversationId, shelf, newWriteKey());
  }
}
