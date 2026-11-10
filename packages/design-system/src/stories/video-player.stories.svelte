<script module lang="ts">
  /*
   * VideoPlayer — Tier 3, our own controls over the browser's <video>. The variant axis is `variant`:
   * `full` is the viewer, `compact` a preview inside a panel. Each story plays a six-second WebM
   * recording built for the catalog (a square sliding across a dark field, with a tone), small enough
   * to sit in the repository. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fn, userEvent, waitFor } from "storybook/test";
  import VideoPlayer from "../lib/components/video-player/index.ts";
  import sampleRecording from "./fixtures/sample-recording.webm";

  const { Story } = defineMeta({
    title: "Data Display/VideoPlayer",
    component: VideoPlayer,
    args: { src: sampleRecording, title: "Deposition of the witness", variant: "full" },
    argTypes: {
      variant: { control: "select", options: ["full", "compact"] },
    },
    parameters: {
      controls: { include: ["variant", "startAt"] },
    },
  });

  type VideoPlayerStoryArgs = ComponentProps<typeof VideoPlayer>;
</script>

{#snippet template(args: VideoPlayerStoryArgs)}
  <div class="max-w-3xl">
    <VideoPlayer {...args} />
  </div>
{/snippet}

<Story
  name="Full"
  args={{ onCopyMoment: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    await step("Names the recording as a region", async () => {
      await expect(
        canvas.getByRole("region", { name: "Deposition of the witness" }),
      ).toBeInTheDocument();
    });
    await step("Learns the recording's length", async () => {
      await waitFor(() => expect(canvas.getByText("0:00:06")).toBeInTheDocument());
    });
    await step("A ten-second step forward stops at the end", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Forward 10 Seconds" }));
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: /Copy Link at 0:00:06/u })).toBeInTheDocument(),
      );
    });
    await step("Copying the moment hands the caller the second", async () => {
      await userEvent.click(canvas.getByRole("button", { name: /Copy Link at/u }));
      await expect(args.onCopyMoment).toHaveBeenCalledWith(6);
    });
    await step("Mute toggles its own name", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Mute" }));
      await expect(canvas.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
    });
  }}
/>

<Story
  name="Compact"
  args={{ variant: "compact", onDownload: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    await step("Offers play, seek, sound, download and full screen", async () => {
      await expect(canvas.getByRole("button", { name: "Play" })).toBeInTheDocument();
      await expect(canvas.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
      await expect(canvas.getByRole("button", { name: "Full Screen" })).toBeInTheDocument();
    });
    await step("Download is the caller's", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Download" }));
      await expect(args.onDownload).toHaveBeenCalledOnce();
    });
  }}
/>

<Story
  name="Cannot Play"
  tags={["!dev", "!autodocs"]}
  args={{ src: "data:video/mp4;base64,AAAA", onUnplayable: fn() }}
  {template}
  play={async ({ args, canvas, step }) => {
    await step("Tells the caller the browser could not play it", async () => {
      await waitFor(() => expect(args.onUnplayable).toHaveBeenCalledOnce());
      await expect(canvas.getByRole("button", { name: "Play" })).toBeDisabled();
    });
  }}
/>
