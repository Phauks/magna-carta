<script module lang="ts">
  /*
   * DigestList — the one recipe for showing a file's fingerprints, shared by the matter file's
   * inspector and the file workbench. The stories are its three renders, which are the three states
   * a digest is ever in: computed, being computed, and not computed. There is no fourth, and the
   * list holds every row in all three so nothing below it moves as values land.
   *
   * Copy is an axis of the FIRST story rather than one of its own: without `onCopy` the values are
   * plain text, which the absent/pending stories already show.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent } from "storybook/test";
  import DigestList from "../lib/components/digest-list/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/DigestList",
    component: DigestList,
  });

  type DigestListStoryArgs = ComponentProps<typeof DigestList>;

  const COMPUTED = [
    {
      algorithm: "SHA-256",
      value: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    },
    { algorithm: "SHA-1", value: "8843d7f92416211de9ebb963ff4ce28125932878" },
    { algorithm: "MD5", value: "6f8db599de986fab7a21625b7916589c" },
  ];

  const NOT_COMPUTED = COMPUTED.map((entry) => ({ algorithm: entry.algorithm, value: null }));
</script>

<Story
  name="Computed"
  args={{ digests: COMPUTED, onCopy: fn() }}
  play={async ({ canvas, args, step }) => {
    const sha256 = canvas.getByRole("button", { name: "Copy the SHA-256 digest" });

    await step("Shows the digest in full, never abbreviated", async () => {
      await expect(sha256).toHaveTextContent(COMPUTED[0]!.value);
    });

    await step("The value itself is the copy control", async () => {
      await userEvent.click(sha256);
      await expect(args.onCopy).toHaveBeenCalledWith(COMPUTED[0]);
    });

    await step("Confirming fills the control without changing its width", async () => {
      await expect(sha256).toHaveClass("mc-digest-list-copied");
    });
  }}
>
  {#snippet template(args: DigestListStoryArgs)}
    <DigestList {...args} />
  {/snippet}
</Story>

<Story
  name="Computing"
  args={{ digests: NOT_COMPUTED, pending: true }}
  play={async ({ canvas, step }) => {
    await step("Every algorithm has its row before any value arrives", async () => {
      await expect(canvas.getByText("SHA-256")).toBeInTheDocument();
      await expect(canvas.getByText("MD5")).toBeInTheDocument();
    });

    await step("A row being computed shows the wait, not the absence", async () => {
      await expect(canvas.queryByText("Not computed yet")).not.toBeInTheDocument();
    });
  }}
>
  {#snippet template(args: DigestListStoryArgs)}
    <DigestList {...args} />
  {/snippet}
</Story>

<Story
  name="Not Computed"
  args={{ digests: NOT_COMPUTED }}
  play={async ({ canvas, step }) => {
    await step("Says so on every row rather than showing a blank", async () => {
      await expect(canvas.getAllByText("Not computed yet")).toHaveLength(NOT_COMPUTED.length);
    });

    await step("Nothing is a copy control when there is nothing to copy", async () => {
      await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
    });
  }}
>
  {#snippet template(args: DigestListStoryArgs)}
    <DigestList {...args} />
  {/snippet}
</Story>
