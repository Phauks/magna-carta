<script module lang="ts">
  /*
   * DefinitionList — named values, framed, with the words about their emptiness inside the frame.
   *
   * The stories are the two states that matter: the list with its values, and the list standing
   * BEFORE its values — every term present, every definition marked empty, and the message about
   * why beneath them inside the same frame. The second is the one the owner asked for: where data
   * will arrive, the structure that holds it renders first, and a reader learns where the values
   * land before any do. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import * as DefinitionList from "../lib/components/definition-list/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/DefinitionList",
    component: DefinitionList.Root,
    parameters: { controls: { disable: true } },
  });

  const ALGORITHMS = ["sha256", "sha512", "sha384", "sha1", "md5"] as const;
  const HEX_RUN = "3b7f9d1e";
  const DIGESTS: Readonly<Record<(typeof ALGORITHMS)[number], string>> = {
    sha256: HEX_RUN.repeat(8),
    sha512: HEX_RUN.repeat(16),
    sha384: HEX_RUN.repeat(12),
    sha1: HEX_RUN.repeat(5),
    md5: HEX_RUN.repeat(4),
  };
</script>

{#snippet filled()}
  <div class="max-w-md">
    <DefinitionList.Root>
      {#each ALGORITHMS as algorithm (algorithm)}
        <DefinitionList.Row term={algorithm.toUpperCase()}>
          <span class="font-mono text-xs">{DIGESTS[algorithm]}</span>
        </DefinitionList.Row>
      {/each}
    </DefinitionList.Root>
  </div>
{/snippet}

<Story
  name="With its values"
  template={filled}
  play={async ({ canvas, canvasElement, step }) => {
    await step("Every term names its value, and a long value wraps inside the frame", async () => {
      await expect(canvas.getAllByRole("term")).toHaveLength(ALGORITHMS.length);
      await expect(canvas.getAllByRole("definition")).toHaveLength(ALGORITHMS.length);
      const list = canvasElement.querySelector("dl");
      await expect(list?.scrollWidth).toBeLessThanOrEqual(list?.clientWidth ?? 0);
    });
  }}
/>

{#snippet beforeItsValues()}
  <div class="max-w-md">
    <DefinitionList.Root>
      {#each ALGORITHMS as algorithm (algorithm)}
        <DefinitionList.Row term={algorithm.toUpperCase()} />
      {/each}
      <DefinitionList.Empty>Nothing to digest yet: no version has been committed.</DefinitionList.Empty>
    </DefinitionList.Root>
  </div>
{/snippet}

<Story
  name="Before its values"
  template={beforeItsValues}
  play={async ({ canvas, canvasElement, step }) => {
    await step("The frame stands with every term and no value", async () => {
      await expect(canvas.getAllByRole("term").length).toBeGreaterThanOrEqual(ALGORITHMS.length);
      const emptyRows = canvasElement.querySelectorAll('[data-empty="true"]');
      await expect(emptyRows).toHaveLength(ALGORITHMS.length);
    });

    await step("An empty definition says so to assistive technology, not only by a mark", async () => {
      await expect(canvas.getAllByText("Not known yet")).toHaveLength(ALGORITHMS.length);
    });

    await step("The words about the emptiness are inside the list, beneath the terms", async () => {
      const list = canvasElement.querySelector("dl");
      const message = canvas.getByText("Nothing to digest yet: no version has been committed.");
      await expect(list?.contains(message)).toBe(true);
      await expect(message.closest('[data-placeholder="true"]')).not.toBeNull();
    });
  }}
/>
