<script module lang="ts">
  /*
   * ItemDrag — Layout. The product's ONE gesture for dragging its own items somewhere else, shown
   * over the shape it exists for: two regions that are each a source and a destination, sharing a
   * single drag, so a row picked up in one lands in the other.
   *
   * WHY THE PLAY FUNCTIONS DISPATCH THEIR OWN EVENTS. There is no user-event gesture for a native
   * HTML drag: the platform's drag is driven by the browser's own drag-and-drop machinery, which a
   * test harness cannot start. So each beat below dispatches the real event sequence with a stand-in
   * transfer — which is also exactly what the component sees in a browser, and what it asserts is
   * the contract a real drag runs through: the payload's media type, the mark on the destination
   * under the pointer, the refusal that never prevents the default, and the clearing on dragend.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, waitFor } from "storybook/test";
  import {
    ITEM_DRAG_KEY_ATTRIBUTE,
    ITEM_DRAG_MEDIA_TYPE,
    ITEM_DROP_KEY_ATTRIBUTE,
    ITEM_DROP_MARK_ATTRIBUTE,
    carriesDraggedItems,
    carriesExternalFiles,
    createItemDrag,
  } from "../lib/components/item-drag/index.ts";

  interface Card {
    readonly key: string;
    readonly label: string;
  }

  const LEFT: Card[] = [
    { key: "card:one", label: "Deposition Transcript" },
    { key: "card:two", label: "Site Photographs" },
  ];
  const RIGHT: Card[] = [{ key: "card:three", label: "Exhibit List" }];

  const { Story } = defineMeta({
    title: "Layout/ItemDrag",
  });

  /** Just enough of a DataTransfer for a synthetic gesture: the story is not testing the browser. */
  class StandInTransfer {
    readonly #held = new Map<string, string>();
    dropEffect = "none";
    effectAllowed = "none";
    get types(): readonly string[] {
      return [...this.#held.keys()];
    }
    setData(type: string, value: string): void {
      this.#held.set(type, value);
    }
    getData(type: string): string {
      return this.#held.get(type) ?? "";
    }
    setDragImage(): void {
      // The browser's job; nothing to do for a stand-in.
    }
  }

  function dragEvent(type: string, transfer: StandInTransfer): DragEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    return event;
  }
</script>

<script lang="ts">
  /*
   * One drag, two regions. The `held` state is what a real surface's write would change; here it
   * moves a card between the two columns so a drop that actually happened is visible.
   */
  let held = $state<Record<string, "left" | "right">>({
    "card:one": "left",
    "card:two": "left",
    "card:three": "right",
  });

  const cards: Card[] = [...LEFT, ...RIGHT];

  const drag = createItemDrag({
    keysFor: (key) => [key],
    describe: (keys) => `${keys.length} items`,
    // A card never lands where it already is: a move that changes nothing is not a move, and a
    // destination that accepted one would put an entry on a history for a gesture with no effect.
    accepts: (keys, targetKey) =>
      keys.every((key) => held[key] !== (targetKey === "column:left" ? "left" : "right")),
    onDrop: (keys, targetKey) => {
      const side = targetKey === "column:left" ? "left" : "right";
      for (const key of keys) held = { ...held, [key]: side };
    },
  });

  const handlers = $derived(drag.handlers());
</script>

{#snippet column(side: "left" | "right", name: string)}
  <div
    class="flex min-h-48 min-w-48 flex-col gap-4 rounded-md border border-border-default p-8"
    {...{ [ITEM_DROP_KEY_ATTRIBUTE]: `column:${side}` }}
    role="group"
    aria-label={name}
  >
    <span class="text-xs font-semibold text-text-muted">{name}</span>
    {#each cards.filter((card) => held[card.key] === side) as card (card.key)}
      <div
        class="rounded-sm border border-border-default bg-surface-default p-8 text-sm"
        draggable="true"
        {...{ [ITEM_DRAG_KEY_ATTRIBUTE]: card.key }}
      >
        {card.label}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet template()}
  <div class="flex gap-12" {...handlers}>
    {@render column("left", "Discovery")}
    {@render column("right", "Exhibits")}
  </div>
{/snippet}

<Story
  name="Two Regions, One Gesture"
  {template}
  play={async ({ canvas, step }) => {
    const source = canvas.getByText("Deposition Transcript");
    const destination = canvas.getByRole("group", { name: "Exhibits" });
    const origin = canvas.getByRole("group", { name: "Discovery" });
    const transfer = new StandInTransfer();

    await step("Picking a card up writes OUR media type, never plain text", async () => {
      source.dispatchEvent(dragEvent("dragstart", transfer));
      await expect(transfer.types).toContain(ITEM_DRAG_MEDIA_TYPE);
      await expect(transfer.types).not.toContain("text/plain");
      await expect(carriesDraggedItems(transfer as unknown as DataTransfer)).toBe(true);
      await expect(carriesExternalFiles(transfer as unknown as DataTransfer)).toBe(false);
    });

    await step("The destination under the pointer is marked, and allows the drop", async () => {
      const over = dragEvent("dragover", transfer);
      destination.dispatchEvent(over);
      await expect(over.defaultPrevented).toBe(true);
      await waitFor(() => expect(destination).toHaveAttribute(ITEM_DROP_MARK_ATTRIBUTE, "true"));
    });

    await step("The column it is ALREADY in refuses by never preventing the default", async () => {
      const over = dragEvent("dragover", transfer);
      origin.dispatchEvent(over);
      await expect(over.defaultPrevented).toBe(false);
      await expect(origin).not.toHaveAttribute(ITEM_DROP_MARK_ATTRIBUTE);
    });

    await step("Dropping moves the card, and the mark is gone", async () => {
      const over = dragEvent("dragover", transfer);
      destination.dispatchEvent(over);
      destination.dispatchEvent(dragEvent("drop", transfer));
      await waitFor(() =>
        expect(canvas.getByRole("group", { name: "Exhibits" })).toHaveTextContent(
          "Deposition Transcript",
        ),
      );
      await expect(destination).not.toHaveAttribute(ITEM_DROP_MARK_ATTRIBUTE);
    });

    await step("A drag begun by something else in the region is left alone", async () => {
      // A table's column header reordering itself bubbles through this same container. Preventing
      // the default here would cancel a gesture that is not ours.
      const foreign = dragEvent("dragstart", new StandInTransfer());
      canvas.getByRole("group", { name: "Discovery" }).dispatchEvent(foreign);
      await expect(foreign.defaultPrevented).toBe(false);
      canvas.getByRole("group", { name: "Discovery" }).dispatchEvent(dragEvent("dragend", transfer));
    });

    await step("A drag abandoned mid-gesture leaves no mark behind", async () => {
      const second = new StandInTransfer();
      canvas.getByText("Site Photographs").dispatchEvent(dragEvent("dragstart", second));
      destination.dispatchEvent(dragEvent("dragover", second));
      await waitFor(() => expect(destination).toHaveAttribute(ITEM_DROP_MARK_ATTRIBUTE, "true"));
      destination.dispatchEvent(dragEvent("dragend", second));
      await waitFor(() => expect(destination).not.toHaveAttribute(ITEM_DROP_MARK_ATTRIBUTE));
    });
  }}
/>
