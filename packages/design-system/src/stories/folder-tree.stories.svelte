<script module lang="ts">
  /*
   * FolderTree — Layout. The file manager's left rail, built on Tree rather than beside it: the
   * root row IS the heading (Home, selectable), the two controls that act on the whole tree sit at
   * its end, folders carry a colour and a mark chosen from two separate flyouts, a folder moves by
   * being dragged, and the views that are not places in the folders sit beneath a rule with no
   * heading of their own.
   *
   * The showcase stories are the rail's states: populated, empty, still loading, deep, and standing
   * somewhere a folder cannot be made. The hidden stories are the claims that are not visible on a
   * static rail and are the ones most often got wrong — a swatch really being square as rendered,
   * a caret opening without selecting, selecting costing no reflow, and a folder refusing to move
   * inside itself. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fireEvent, fn, screen, userEvent, waitFor } from "storybook/test";
  import FileSearch from "@lucide/svelte/icons/file-search";
  import RotateCounterClockwiseClock from "@lucide/svelte/icons/rotate-ccw-clock";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash-2";
  import FolderTree from "../lib/components/folder-tree/index.ts";
  import { FOLDER_COLORS } from "../lib/components/folder-tree/index.ts";
  import type {
    FolderTreeNode,
    FolderTreeView,
  } from "../lib/components/folder-tree/index.ts";

  /**
   * A folder row by its label. The row's name also says the file count it shows ("Pleadings 12
   * files"), so a story that means the folder matches the label and whatever count follows it.
   * The labels here are plain words, so the label goes into the pattern as it is.
   */
  function folderNamed(label: string): RegExp {
    return new RegExp("^" + label + "( \\d+ files?)?$");
  }

  const FOLDERS: FolderTreeNode[] = [
    {
      id: "pleadings",
      label: "Pleadings",
      color: "blue",
      fileCount: 12,
      children: [
        { id: "complaint", label: "Complaint", fileCount: 3 },
        { id: "answers", label: "Answers", fileCount: 4, color: "green" },
      ],
    },
    {
      id: "discovery",
      label: "Discovery",
      color: "red",
      icon: "search",
      fileCount: 48,
      children: [
        { id: "depositions", label: "Depositions", fileCount: 9 },
        { id: "exhibits", label: "Exhibits", fileCount: 21, icon: "bookmark" },
        {
          id: "photographs",
          label: "Site Photographs",
          fileCount: 8,
          children: [{ id: "site-north", label: "North Elevation", fileCount: 8 }],
        },
      ],
    },
    { id: "correspondence", label: "Correspondence", fileCount: 31, icon: "archive" },
    { id: "privileged", label: "Privileged", icon: "lock", color: "yellow", fileCount: 2 },
  ];

  const VIEWS: FolderTreeView[] = [
    { id: "analysis", label: "File Analysis", icon: FileSearch },
    { id: "deleted", label: "Deleted Files", icon: Trash },
    { id: "history", label: "History", icon: RotateCounterClockwiseClock },
    { id: "results", label: "Search Results", icon: Search },
  ];

  /** A rail deep enough to walk, for the dense reading and for the open/close control. */
  const DEEP: FolderTreeNode[] = [
    {
      id: "matter",
      label: "Matter Working Papers",
      fileCount: 210,
      children: Array.from({ length: 6 }, (_unused, outer) => ({
        id: `band-${outer}`,
        label: `Production Band ${outer + 1}`,
        fileCount: 35,
        children: Array.from({ length: 4 }, (_inner, inner) => ({
          id: `band-${outer}-set-${inner}`,
          label: `Set ${inner + 1}`,
          fileCount: 9,
        })),
      })),
    },
    ...FOLDERS,
  ];

  const { Story } = defineMeta({
    title: "Layout/FolderTree",
    component: FolderTree,
    args: {
      folders: FOLDERS,
      views: VIEWS,
      selectedFolderId: null,
      expandedFolderIds: ["discovery"],
      showFileCounts: true,
    },
  });

  type FolderTreeStoryArgs = ComponentProps<typeof FolderTree>;

  /** The rail lives in a resizable pane on the real screen; a fixed frame stands in for one here. */
</script>

{#snippet template(args: FolderTreeStoryArgs)}
  <div class="h-96 w-64 border-r border-border-default">
    <FolderTree {...args} class="h-full" />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, canvasElement, step }) => {
    await step("The heading is the root row: Home is a selectable treeitem", async () => {
      const home = canvas.getByRole("treeitem", { name: "Home" });
      await expect(home).toBeInTheDocument();
      await expect(home).toHaveAttribute("aria-selected", "true");
      await expect(canvas.queryByText("Folders")).toBeNull();
    });

    await step("The two controls that act on the whole tree sit at the root row's end", async () => {
      const home = canvas.getByRole("treeitem", { name: "Home" });
      await expect(home).toContainElement(canvas.getByRole("button", { name: "Expand All" }));
      await expect(home).toContainElement(canvas.getByRole("button", { name: "New Folder" }));
    });

    await step("One control opens and closes, and says which it will do", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Expand All" }));
      await waitFor(() =>
        expect(
          canvas.getByRole("treeitem", { name: folderNamed("North Elevation") }),
        ).toBeVisible(),
      );
      await expect(canvas.queryByRole("button", { name: "Expand All" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Collapse All" }));
      await waitFor(() =>
        expect(canvas.queryByRole("treeitem", { name: folderNamed("Depositions") })).toBeNull(),
      );
    });

    await step("Folders state how many files they hold", async () => {
      await expect(
        canvas.getByRole("treeitem", { name: folderNamed("Correspondence") }),
      ).toHaveTextContent("31");
    });

    await step("The views sit beneath the rule, self-describing, with no heading", async () => {
      await expect(canvas.getByRole("button", { name: "Deleted Files" })).toBeInTheDocument();
      await expect(canvas.queryByText("Views")).toBeNull();
    });

    await step("A folder that was given a colour draws its glyph in that colour", async () => {
      const coloured = canvas
        .getByRole("treeitem", { name: folderNamed("Discovery") })
        .querySelector('.mc-folder-tree-icon[data-folder-color="red"]') as HTMLElement;
      const plain = canvas
        .getByRole("treeitem", { name: folderNamed("Correspondence") })
        .querySelector('.mc-folder-tree-icon[data-folder-color="none"]') as HTMLElement;
      await expect(coloured).toBeInTheDocument();
      await expect(getComputedStyle(coloured).color).not.toBe(getComputedStyle(plain).color);
    });

    await step("The root row is exactly as tall as a folder row, measured as rendered", async () => {
      const home = canvas
        .getByRole("treeitem", { name: "Home" });
      const folder = canvas
        .getByRole("treeitem", { name: folderNamed("Correspondence") });
      await expect(home.getBoundingClientRect().height).toBeCloseTo(
        folder.getBoundingClientRect().height,
        1,
      );
    });

    await step("The rail keeps its scrollbar space, and sits on the spacing rhythm", async () => {
      const scroller = canvasElement.querySelector(".mc-folder-tree-scroll") as HTMLElement;
      const style = getComputedStyle(scroller);
      await expect(style.scrollbarGutter).toBe("stable");
      await expect(style.paddingTop).toBe("4px");
      await expect(style.paddingLeft).toBe("4px");
      const rule = canvasElement.querySelector(".mc-folder-tree-separator") as HTMLElement;
      await expect(getComputedStyle(rule).marginTop).toBe("4px");
    });
  }}
/>

<Story
  name="Empty"
  args={{
    folders: [],
    views: VIEWS,
    selectedFolderId: null,
    expandedFolderIds: [],
    emptyMessage: "No folders yet.",
  }}
  {template}
  play={async ({ canvas, step }) => {
    await step("The root row still stands, and the rail says plainly that it is empty", async () => {
      await expect(canvas.getByRole("treeitem", { name: "Home" })).toBeInTheDocument();
      // The sentence is the CALLER's, not a default: a rail given none shows none.
      await expect(canvas.getByText("No folders yet.")).toBeVisible();
    });
    await step("Nothing can be opened, so the open/close control is disabled", async () => {
      await expect(canvas.getByRole("button", { name: "Expand All" })).toBeDisabled();
    });
  }}
/>

<Story
  name="Loading"
  args={{ folders: [], views: VIEWS, loading: true }}
  {template}
  play={async ({ canvas, canvasElement, step }) => {
    await step("The rail holds its shape and says it is busy", async () => {
      await expect(canvas.queryByRole("tree")).toBeNull();
      await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });
  }}
/>

<Story
  name="Dense"
  args={{
    folders: DEEP,
    views: VIEWS,
    selectedFolderId: "band-2",
    expandedFolderIds: ["matter", "band-2", "discovery"],
  }}
  {template}
  play={async ({ canvas, step }) => {
    await step("Deep nesting stays walkable and the selected folder reads as selected", async () => {
      await expect(
        canvas.getByRole("treeitem", { name: folderNamed("Production Band 3") }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(canvas.getByRole("treeitem", { name: folderNamed("Set 4") })).toBeVisible();
    });
  }}
/>

<Story
  name="Nowhere to put a folder"
  args={{
    folders: FOLDERS,
    views: VIEWS,
    currentViewId: "analysis",
    newFolderDisabledReason: "There is no current folder in File Analysis.",
  }}
  {template}
  play={async ({ canvas, step }) => {
    await step("The control still renders, disabled, saying what it waits on", async () => {
      const control = canvas.getByRole("button", { name: "New Folder" });
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute(
        "title",
        "There is no current folder in File Analysis.",
      );
    });
    await step("A view being open means no folder reads as the current place", async () => {
      await expect(canvas.getByRole("treeitem", { name: "Home" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
      await expect(canvas.getByRole("button", { name: "File Analysis" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }}
/>

<!-- The caret, and what selecting must not cost. Neither is visible on a static rail. -->
<Story
  name="Carets and the cost of selecting"
  tags={["!dev", "!autodocs"]}
  {template}
  play={async ({ canvas, step }) => {
    const discovery = canvas.getByRole("treeitem", { name: folderNamed("Discovery") });

    await step("The caret closes and opens the folder, and selects nothing", async () => {
      const caret = discovery.querySelector("[data-tree-twisty]") as HTMLElement;
      await userEvent.click(caret);
      await waitFor(() => expect(discovery).toHaveAttribute("aria-expanded", "false"));
      await expect(discovery).toHaveAttribute("aria-selected", "false");
      await userEvent.click(caret);
      await waitFor(() => expect(discovery).toHaveAttribute("aria-expanded", "true"));
      await expect(discovery).toHaveAttribute("aria-selected", "false");
    });

    await step("Selecting a folder moves nothing on the rail", async () => {
      const label = discovery.querySelector(".mc-tree-item-label") as HTMLElement;
      const neighbour = canvas.getByRole("treeitem", { name: folderNamed("Correspondence") });
      const before = label.getBoundingClientRect();
      const neighbourBefore = neighbour.getBoundingClientRect();

      await userEvent.click(label);
      await waitFor(() => expect(discovery).toHaveAttribute("aria-selected", "true"));

      const after = label.getBoundingClientRect();
      const neighbourAfter = neighbour.getBoundingClientRect();
      await expect(after.left).toBeCloseTo(before.left, 1);
      await expect(after.width).toBeCloseTo(before.width, 1);
      await expect(neighbourAfter.top).toBeCloseTo(neighbourBefore.top, 1);
      await expect(discovery).toHaveAttribute("aria-expanded", "true");
    });
  }}
/>

<!-- The two flyouts, and the swatch geometry, measured as rendered rather than as written. -->
<Story
  name="Colour and mark"
  tags={["!dev", "!autodocs"]}
  args={{
    folders: FOLDERS,
    views: VIEWS,
    onChangeColor: fn(),
    onChangeIcon: fn(),
  }}
  {template}
  play={async ({ args, canvas, step }) => {
    const privileged = canvas.getByRole("treeitem", { name: folderNamed("Privileged") });

    await step("Right-clicking a folder in the rail opens a menu", async () => {
      await fireEvent.contextMenu(privileged, { clientX: 24, clientY: 24 });
      await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    });

    await step("Colour and mark are two items, neither reached through the other", async () => {
      await expect(screen.getByRole("menuitem", { name: /Color/ })).toBeInTheDocument();
      await expect(screen.getByRole("menuitem", { name: /Icon/ })).toBeInTheDocument();
    });

    await step("The pip beside the Color label is a true square as rendered", async () => {
      const pip = document.querySelector(".mc-folder-tree-pip") as HTMLElement;
      const box = pip.getBoundingClientRect();
      await expect(box.width).toBeCloseTo(box.height, 1);
      await expect(box.width).toBeGreaterThan(0);
      const radius = getComputedStyle(pip).borderRadius;
      await expect(radius.replaceAll(/[^0-9.]/g, "")).toBe("0");
    });

    await step("The palette runs in spectrum order and includes pink", async () => {
      await userEvent.click(screen.getByRole("menuitem", { name: /Color/ }));
      await waitFor(() => expect(document.querySelectorAll(".mc-folder-tree-swatch")).toHaveLength(
        FOLDER_COLORS.length,
      ));
      const rendered = [...document.querySelectorAll(".mc-folder-tree-swatch")].map((swatch) =>
        swatch.getAttribute("aria-label"),
      );
      await expect(rendered).toEqual(FOLDER_COLORS.map((color) => color.label));
      await expect(rendered).toContain("Pink");
    });

    await step("Every swatch carries a fill of its own — no two read the same", async () => {
      const fills = [...document.querySelectorAll(".mc-folder-tree-swatch")].map(
        (swatch) => getComputedStyle(swatch).backgroundColor,
      );
      await expect(new Set(fills).size).toBe(FOLDER_COLORS.length);
    });

    await step("Every swatch is a true square as rendered, with no corner radius", async () => {
      for (const swatch of document.querySelectorAll(".mc-folder-tree-swatch")) {
        const box = swatch.getBoundingClientRect();
        expect(box.width).toBeCloseTo(box.height, 1);
        expect(box.width).toBeGreaterThan(0);
        expect(getComputedStyle(swatch).borderRadius.replaceAll(/[^0-9.]/g, "")).toBe("0");
      }
    });

    await step("The chosen colour is a check inside its own swatch", async () => {
      const chosen = document.querySelector(
        '.mc-folder-tree-swatch[data-folder-color="yellow"]',
      ) as HTMLElement;
      const check = chosen.querySelector(".mc-folder-tree-swatch-check") as HTMLElement;
      await expect(check).toBeInTheDocument();
      const swatchBox = chosen.getBoundingClientRect();
      const checkBox = check.getBoundingClientRect();
      await expect(checkBox.left).toBeGreaterThanOrEqual(swatchBox.left - 1);
      await expect(checkBox.right).toBeLessThanOrEqual(swatchBox.right + 1);
      await expect(checkBox.top).toBeGreaterThanOrEqual(swatchBox.top - 1);
      await expect(checkBox.bottom).toBeLessThanOrEqual(swatchBox.bottom + 1);
    });

    await step("A hovered swatch keeps its own colour", async () => {
      const green = document.querySelector(
        '.mc-folder-tree-swatch[data-folder-color="green"]',
      ) as HTMLElement;
      const resting = getComputedStyle(green).backgroundColor;
      await userEvent.hover(green);
      await waitFor(() => expect(green).toHaveAttribute("data-highlighted"));
      await expect(getComputedStyle(green).backgroundColor).toBe(resting);
      await expect(getComputedStyle(green).outlineWidth).not.toBe("0px");
    });

    await step("Choosing a colour reports it, and the menu closes behind it", async () => {
      await userEvent.click(
        document.querySelector('.mc-folder-tree-swatch[data-folder-color="green"]') as HTMLElement,
      );
      await waitFor(() =>
        expect(args.onChangeColor).toHaveBeenCalledWith({
          folderId: "privileged",
          color: "green",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    });

    await step("The mark is its own flyout, reached without going through the colour", async () => {
      await fireEvent.contextMenu(privileged, { clientX: 24, clientY: 24 });
      await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("menuitem", { name: /Icon/ }));
      await waitFor(() => expect(screen.getByRole("menuitem", { name: "Archive" })).toBeVisible());
      await expect(screen.getByRole("menuitem", { name: "Plain" })).toBeVisible();
      await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
      await waitFor(() =>
        expect(args.onChangeIcon).toHaveBeenCalledWith({
          folderId: "privileged",
          icon: "archive",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    });
  }}
/>

<!-- Moving a folder, and the two destinations that are refused before the pointer is told otherwise. -->
<Story
  name="Moving a folder"
  tags={["!dev", "!autodocs"]}
  args={{
    folders: FOLDERS,
    views: VIEWS,
    expandedFolderIds: ["discovery", "photographs"],
    onMoveFolder: fn(),
  }}
  {template}
  play={async ({ args, canvas, step }) => {
    const photographs = canvas.getByRole("treeitem", { name: folderNamed("Site Photographs") });
    const correspondence = canvas.getByRole("treeitem", { name: folderNamed("Correspondence") });
    const inside = canvas.getByRole("treeitem", { name: folderNamed("North Elevation") });
    const transfer = new DataTransfer();
    const drag = (kind: string, target: HTMLElement) =>
      target.dispatchEvent(
        new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );

    // The mark lands on the treeitem, which is the ROW: its open children are a sibling group, so
    // a mark never runs down the whole branch beneath the destination.

    await step("Every folder row is a drag source", async () => {
      await expect(photographs).toHaveAttribute("draggable", "true");
    });

    await step("A folder is never told it may land inside itself", async () => {
      drag("dragstart", photographs);
      drag("dragover", inside);
      await waitFor(() => expect(inside).not.toHaveAttribute("data-item-drop-marked"));
      drag("dragover", photographs);
      await waitFor(() => expect(photographs).not.toHaveAttribute("data-item-drop-marked"));
    });

    await step("A folder it can go into is marked, and dropping reports the move", async () => {
      drag("dragover", correspondence);
      await waitFor(() =>
        expect(correspondence).toHaveAttribute("data-item-drop-marked", "true"),
      );
      drag("drop", correspondence);
      await waitFor(() =>
        expect(args.onMoveFolder).toHaveBeenCalledWith({
          folderId: "photographs",
          destinationFolderId: "correspondence",
        }),
      );
    });

    await step("Dragging out to the root row reports a move to the root", async () => {
      const home = canvas.getByRole("treeitem", { name: "Home" });
      drag("dragstart", photographs);
      drag("dragover", home);
      await waitFor(() => expect(home).toHaveAttribute("data-item-drop-marked", "true"));
      drag("drop", home);
      await waitFor(() =>
        expect(args.onMoveFolder).toHaveBeenCalledWith({
          folderId: "photographs",
          destinationFolderId: null,
        }),
      );
      drag("dragend", photographs);
    });
  }}
/>
